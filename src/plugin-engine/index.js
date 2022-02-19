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
  helpers: ctx => ({
    xmlTransformer: async (pattern, callback) => {
      const files = multimatch(ctx.finalFileList, pattern)
      const inMemoryFileMap = Object.fromEntries(ctx.inMemoryFiles.map(x => [x.fileName, x]))
      for (const f of files) {
        inMemoryFileMap[f].transformed = inMemoryFileMap[f].transformed || await parseXml(inMemoryFileMap[f].data)
        await callback(f, Object.values(inMemoryFileMap[f].transformed)[0])
      }
    },
    filterMetadata: async (filterFn) => {
      ctx.finalFileList = _(ctx.finalFileList).reject(filterFn).values()
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
      }, module.exports.helpers(ctx), { parseXml, buildXml, parseXmlNoArray }))
      .resolve()
      .values()
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
  }
}
