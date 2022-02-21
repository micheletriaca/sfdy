const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml } = require('../utils/xml-utils')
const globby = require('globby')
const pathService = require('../services/path-service')
const _ = require('exstream.js')
const l = require('lodash')
const { readFiles } = require('../services/file-service')

const genExcludeFilesFromExtractedFileList = ctx => patterns => {
  const matches = multimatch(Object.keys(ctx.inMemoryFilesMap), patterns)
  matches.forEach(m => { ctx.inMemoryFilesMap[m].filteredByPlugin = true })
}

const genXmlTransformer = ctx => async (patterns, callback) => {
  const matches = multimatch(Object.keys(ctx.inMemoryFilesMap), patterns)
  for (const m of matches) {
    const f = ctx.inMemoryFilesMap[m]
    f.transformed = f.transformed || await parseXml(f.data)
    await callback(f.fileName, Object.values(f.transformed)[0])
  }
}

const genGetFiles = ctx => async (patterns, readBuffers = true, onlyFromFilesystem = false) => {
  // TODO -> REMAPPER INVERSI
  // TODO -> SE FACCIO REQUIRE METADATA DEVO POI POTERLI TOGLIERE. VANNO TENUTI DA QLC PARTE
  const fileList = await globby(patterns, { cwd: pathService.getSrcFolder(true) })
  const fileListInMemory = multimatch(Object.keys(ctx.inMemoryFilesMap), patterns)
  const wholeFileList = [...new Set([...fileList, ...fileListInMemory])]
  if (!readBuffers && onlyFromFilesystem) {
    return fileList
  } else if (!readBuffers && !onlyFromFilesystem) {
    return wholeFileList
  } else if (readBuffers && onlyFromFilesystem) {
    return readFiles(fileList)
  } else if (readBuffers && !onlyFromFilesystem) {
    const notInMemory = l.difference(fileList, fileListInMemory)
    const inMemory = wholeFileList.filter(f => ctx.inMemoryFilesMap[f])
    const buffers = readFiles(notInMemory)
    for (const f of inMemory) buffers.push(ctx.inMemoryFilesMap[f])
    return buffers
  }
  // TODO -> RIAPPLICARE RENDERER INVERSI
}

const executePlugins = async (plugins = [], ctx, config = {}) => {
  const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
  ctx.inMemoryFilesMap = _(ctx.inMemoryFiles).keyBy('fileName').value()
  const excludeFilesFromExtractedFileList = genExcludeFilesFromExtractedFileList(ctx)
  const xmlTransformer = genXmlTransformer(ctx)
  const getFiles = genGetFiles(ctx)
  const helpers = { excludeFilesFromExtractedFileList, xmlTransformer, getFiles }
  for (const p of plugins) await p(pCtx, helpers)
}

module.exports = {
  executeBeforeRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    return executePlugins(plugins.map(x => x.beforeRetrieve).filter(x => x), ctx, config)
  },
  executeAfterRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    return executePlugins(plugins.map(x => x.afterRetrieve).filter(x => x), ctx, config)
  }
}
