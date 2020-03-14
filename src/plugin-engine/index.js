const multimatch = require('multimatch')
const _ = require('highland')
const l = require('lodash')
const path = require('path')
const { parseXml, buildXml } = require('../utils/xml-utils')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const log = require('../services/log-service').getLogger()
const globby = require('globby')
const fs = require('fs')

const transformations = []
const filterFns = []
const requireMetadata = []

const requireFiles = inMemoryFiles => {
  const cache = new Map()

  return async requiredFiles => {
    if (cache.has(requiredFiles)) return cache.get(requiredFiles)
    console.time('requireFiles')
    const storedFiles = await globby(requiredFiles, { cwd: pathService.getBasePath() + '/' + pathService.getSrcFolder() })
    const inMemoryFileMatches = multimatch(l.map(inMemoryFiles, 'fileName'), requiredFiles)
    const absSrcPath = path.join(pathService.getBasePath(), pathService.getSrcFolder())
    l.difference(storedFiles, inMemoryFileMatches).forEach(f => {
      inMemoryFiles.push({
        fileName: f,
        data: fs.readFileSync(path.join(absSrcPath, f))
      })
    })
    const res = inMemoryFiles.filter(x => multimatch(x.fileName, requiredFiles).length > 0)
    cache.set(requiredFiles, res)
    console.timeEnd('requireFiles')
    return res
  }
}

module.exports = {
  helpers: {
    xmlTransformer: (pattern, callback) => {
      transformations.push({
        pattern,
        callback
      })
    },
    filterMetadata: (filterFn) => {
      filterFns.push(filterFn)
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
    await _(plugins || [])
      .map(pluginPath => {
        if (typeof (pluginPath) === 'function') return pluginPath
        return nativeRequire(path.resolve(pathService.getBasePath(), pluginPath))
      })
      .map(plugin => plugin({
        sfdcConnector,
        environment: process.env.environment,
        username,
        log,
        pkg: l.cloneDeep(pkgJson),
        config
      }, module.exports.helpers))
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
  applyTransformations: async (targetFiles, sfdcConnector) => {
    const fileMap = await l.keyBy(targetFiles, 'fileName')
    const filePaths = Object.keys(fileMap)
    console.time('transformations')
    console.time('parsing+callback')
    const cachedRequireFiles = requireFiles(targetFiles)
    await _(transformations)
      .flatMap(t => multimatch(filePaths, t.pattern).map(pattern => ({ ...t, pattern })))
      .map(async t => {
        const transformedJson = fileMap[t.pattern].transformedJson || await parseXml(fileMap[t.pattern].data)
        fileMap[t.pattern].transformedJson = transformedJson
        const rootKey = Object.keys(transformedJson)[0]
        await (t.callback(
          t.pattern,
          transformedJson[rootKey],
          cachedRequireFiles
        ) || transformedJson[rootKey])
        return t
      })
      .map(x => _(x))
      .sequence()
      .collect()
      .tap(() => console.timeEnd('parsing+callback'))
      .map(tL => {
        console.time('building')
        Object.values(l.keyBy(tL, 'pattern')).forEach(t => {
          fileMap[t.pattern].data = buildXml(fileMap[t.pattern].transformedJson) + '\n'
        })
        console.timeEnd('building')
        return tL
      })
      .collect()
      .toPromise(Promise)
    console.timeEnd('transformations')
  },
  buildFinalPackageXml: async (deltaPackage, storedPackage) => {
    const targetMetadatas = deltaPackage.types.flatMap(x => x.members.map(y => x.name[0] + '/' + y))
    console.time('ttt')
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

    const finalPackage = l.cloneDeep(deltaPackage)
    const mergedTypes = l.keyBy(storedPackage.types.filter(x => finalPackageInfo.filters.has(x.name[0])), x => x.name[0])
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

    return {
      ...finalPackage,
      types: Object.values(l.mergeWith(
        deltaPackageTypes,
        patchedPackageTypes,
        merger
      ))
    }
  }
}
