const multimatch = require('multimatch')
const _ = require('exstream.js')
const l = require('lodash')
const path = require('path')
const { parseXml, buildXml, parseXmlNoArray } = require('../utils/xml-utils')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const logger = require('../services/log-service')
const globby = require('globby')
const fs = require('fs')
const del = require('del')
const { getCompanionsFileList } = require('../utils/package-utils')

const requireMetadata = []

const filesToClean = new Set()

const requireFiles = inMemoryFiles => {
  const cache = new Map()

  return async requiredFiles => {
    if (cache.has(requiredFiles)) return cache.get(requiredFiles)
    logger.time('requireFiles')
    const storedFiles = await globby(requiredFiles, { cwd: pathService.getSrcFolder(true) })
    const inMemoryFileMatches = multimatch(inMemoryFiles.map(x => x.fileName), requiredFiles)
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

const addFiles = (inMemoryFiles, fileList) => f => {
  const idx = inMemoryFiles.findIndex(x => x.fileName === f.fileName)
  if (idx === -1) inMemoryFiles.push(f)
  else inMemoryFiles[idx] = f
  if (!fileList.indexOf(f.fileName)) fileList.push(f.fileName)
}

const cleanFiles = (...files) => files.forEach(f => filesToClean.add(f))

module.exports = {
  helpers: (ctx, requireFiles, addFiles) => ({
    xmlTransformer: async (pattern, callback) => {
      const files = multimatch(ctx.finalFileList, pattern)
      const inMemoryFileMap = Object.fromEntries(ctx.inMemoryFiles.map(x => [x.fileName, x]))
      for (const f of files) {
        inMemoryFileMap[f].transformed = inMemoryFileMap[f].transformed || await parseXml(inMemoryFileMap[f].data)
        await callback(f, Object.values(inMemoryFileMap[f].transformed)[0], { requireFiles, addFiles })
      }
    },
    filterMetadata: async (filterFn) => {
      ctx.finalFileList = _(ctx.finalFileList).reject(filterFn).values()
    },
    applyRemapper: async (regexp, callback) => {
      ctx.finalFileList = await _(ctx.finalFileList)
        .asyncMap(async f => {
          if (!regexp.test(f)) return f
          else return await callback(f, f.match(regexp))
        })
        .uniq()
        .values()
      const companionData = await getCompanionsFileList(ctx.finalFileList, ctx.packageMapping)
      ctx.finalFileList = [...new Set([...ctx.finalFileList, ...companionData.companionFileList])].sort()
      await requireFiles(ctx.finalFileList)
    },
    requireMetadata: (pattern, callback) => {
      requireMetadata.push({
        pattern,
        callback
      })
    }
  }),
  executePlugins: async (plugins, ctx, config = {}) => {
    await _(plugins || [])
      .map(pluginPath => {
        if (typeof (pluginPath) === 'function') return pluginPath
        return nativeRequire(path.resolve(pathService.getBasePath(), pluginPath))
      })
      .map(plugin => plugin({
        ctx,
        environment: process.env.environment,
        log: logger.log,
        config
      }, module.exports.helpers(
        ctx,
        requireFiles(ctx.inMemoryFiles),
        addFiles(ctx.inMemoryFiles, ctx.finalFileList),
        { parseXml, buildXml, parseXmlNoArray })
      ))
      .resolve()
      .values()
  },
  applyCleans: async () => {
    await del([...filesToClean], {
      cwd: path.join(pathService.getBasePath(), pathService.getSrcFolder())
    })
  }
}
