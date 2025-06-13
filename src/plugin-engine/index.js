const multimatch = require('multimatch')
const _ = require('highland')
const l = require('lodash')
const path = require('path')
const { parseXml, buildXml, parseXmlNoArray } = require('../utils/xml-utils')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const logger = require('../services/log-service')
const globby = require('globby')
const fs = require('fs')
const del = require('del')
const chalk = require('chalk')

const transformations = []
const filterFns = []
const requireMetadata = []
const remappers = []

const filesToClean = new Set()

const requireFiles = inMemoryFiles => {
  const cache = new Map()

  return async requiredFiles => {
    if (cache.has(requiredFiles)) return cache.get(requiredFiles)
    logger.time('requireFiles')
    const storedFiles = await globby(requiredFiles, { cwd: pathService.getSrcFolder(true) })
    const inMemoryFileMatches = multimatch(l.map(inMemoryFiles, 'fileName'), requiredFiles)
    const absSrcPath = pathService.getSrcFolder(true)
    l.difference(storedFiles, inMemoryFileMatches).forEach(f => {
      inMemoryFiles.push({
        fileName: f,
        data: fs.readFileSync(path.join(absSrcPath, f))
      })
    })
    const res = inMemoryFiles.filter(x => multimatch(x.fileName, requiredFiles).length > 0)
    cache.set(requiredFiles, res)
    logger.timeEnd('requireFiles')
    return res
  }
}

const addFiles = inMemoryFiles => f => inMemoryFiles.push(f)
const cleanFiles = (...files) => files.forEach(f => filesToClean.add(f))

module.exports = {
  helpers: {
    xmlTransformer: (pattern, callback) => {
      transformations.push({
        pattern,
        callback,
        type: 'xmlTransformer'
      })
    },
    modifyRawContent: (pattern, callback) => {
      transformations.push({
        pattern,
        callback,
        type: 'modifyRawContent'
      })
    },
    filterMetadata: (filterFn) => {
      filterFns.push(filterFn)
    },
    addRemapper: (regexp, callback) => {
      remappers.push({
        regexp,
        callback
      })
    },
    requireMetadata: (pattern, callback) => {
      requireMetadata.push({
        pattern,
        callback
      })
    }
  },
  registerPlugins: async (plugins, sfdcConnector, username, pkgJson, config = {}) => {
    transformations.length = 0
    filterFns.length = 0
    requireMetadata.length = 0
    remappers.length = 0
    filesToClean.clear()

    await _(plugins || [])
      .map(pluginPath => {
        if (typeof (pluginPath) === 'function') return pluginPath
        return nativeRequire(path.resolve(pathService.getBasePath(), pluginPath))
      })
      .map(plugin => plugin({
        sfdcConnector,
        environment: process.env.environment,
        username,
        log: logger.log,
        pkg: l.cloneDeep(pkgJson),
        config
      }, module.exports.helpers, { parseXml, buildXml, parseXmlNoArray }))
      .map(x => _(x))
      .sequence()
      .collect()
      .toPromise(Promise)
  },
  applyFilters: () => f => {
    for (let i = 0; i < filterFns.length; i++) {
      if (!filterFns[i](f.fileName, f.data)) return false
    }
    return true
  },
  applyRemappers: targetFiles => {
    return targetFiles.map(f => {
      return remappers.filter(r => r.regexp.test(f)).reduce((res, r) => r.callback(res, r.regexp), f)
    })
  },
  applyCleans: async () => {
    await del([...filesToClean], {
      cwd: path.join(pathService.getBasePath(), pathService.getSrcFolder())
    })
  },
  applyTransformations: async (targetFiles) => {
    const fileMap = await l.keyBy(targetFiles, 'fileName')
    const filePaths = Object.keys(fileMap)
    logger.time('transformations')
    logger.time('parsing+callback')
    const cachedRequireFiles = requireFiles(targetFiles)
    await _(transformations)
      .flatMap(t => multimatch(filePaths, t.pattern).map(pattern => ({ ...t, pattern })))
      .map(async t => {
        try {
          if (t.type === 'xmlTransformer') {
            const transformedJson = fileMap[t.pattern].transformedJson || await parseXml(fileMap[t.pattern].data)
            fileMap[t.pattern].transformedJson = transformedJson
            const rootKey = Object.keys(transformedJson)[0]
            await (t.callback(
              t.pattern,
              transformedJson[rootKey],
              cachedRequireFiles,
              addFiles(targetFiles),
              cleanFiles
            ) || transformedJson[rootKey])
            return t
          } else {
            await (t.callback(
              t.pattern,
              fileMap[t.pattern],
              cachedRequireFiles,
              addFiles(targetFiles),
              cleanFiles
            ))
            return t
          }
        } catch (e) {
          console.error(chalk.red(`Error in transformation for pattern ${t.pattern}:\n ${e.message}`))
          throw e
        }
      })
      .map(x => _(x))
      .sequence()
      .collect()
      .tap(() => logger.timeEnd('parsing+callback'))
      .map(tL => {
        logger.time('building')
        Object.values(l.keyBy(tL, 'pattern')).forEach(t => {
          if (t.type === 'xmlTransformer') {
            fileMap[t.pattern].data = Buffer.from(buildXml(fileMap[t.pattern].transformedJson) + '\n', 'utf8')
          }
        })
        logger.timeEnd('building')
        return tL
      })
      .collect()
      .toPromise(Promise)
    logger.timeEnd('transformations')
  },
  buildFinalPackageXml: async (deltaPackage, storedPackage) => {
    logger.time('finalPackage')
    const targetMetadatas = deltaPackage.types.flatMap(x => x.members.map(y => x.name[0] + '/' + y))
    const finalPackageInfo = await _(requireMetadata)
      .flatMap(rm => multimatch(targetMetadatas, rm.pattern).map(pattern => ({ ...rm, pattern })))
      .map(async rm => {
        const filters = []
        const patches = []
        const filterPackage = m => filters.push(m)
        const patchPackage = m => patches.push(m)
        await rm.callback({ filterPackage, patchPackage })
        return { ...rm, filters: filters.flat(), patches: patches.flat() }
      })
      .map(x => _(x))
      .parallel(5)
      .reduce({ filters: [], patches: [] }, (memo, x) => ({
        filters: x.filters.concat(memo.filters),
        patches: x.patches.concat(memo.patches)
      }))
      .map(x => ({
        filters: new Set(x.filters),
        patches: x.patches
      }))
      .toPromise(Promise)
    logger.timeLog('finalPackage', 'after multimatch')
    const finalPackage = l.cloneDeep(deltaPackage)
    const mergedTypes = l.keyBy(storedPackage.types.filter(x => {
      if (!x.name) {
        logger.log(chalk.red('package.xml is missing a <name> tag inside a <types> tag. Fix it and try again'))
        process.exit(1)
      }
      return finalPackageInfo.filters.has(x.name[0])
    }), x => x.name[0])
    const deltaPackageTypes = l.keyBy(finalPackage.types, x => x.name[0])

    const merger = (objValue, srcValue) => {
      if (_.isArray(objValue)) {
        const uniqueValues = new Set(objValue.concat(srcValue))
        if (uniqueValues.has('*')) return ['*']
        return [...uniqueValues]
      }
    }

    const patchedPackageTypes = finalPackageInfo.patches.reduce((memo, x) => {
      const idx = x.indexOf('/')
      const metaName = x.substring(0, idx)
      return l.mergeWith(memo, {
        [metaName]: {
          name: metaName,
          members: [x.substring(idx + 1)]
        }
      }, merger)
    }, mergedTypes)

    const res = {
      ...finalPackage,
      types: Object.values(l.mergeWith(
        deltaPackageTypes,
        patchedPackageTypes,
        merger
      ))
    }

    logger.timeEnd('finalPackage', 'after merge')
    return res
  }
}
