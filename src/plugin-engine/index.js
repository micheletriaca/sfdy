const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml } = require('../utils/xml-utils')
const globby = require('globby')
const pathService = require('../services/path-service')
const _ = require('exstream.js')
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

const genGetFilesFromFilesystem = () => async (patterns, readBuffers = true) => {
  // TODO -> REMAPPER INVERSI
  const fileList = await globby(patterns, { cwd: pathService.getSrcFolder(true) })
  return readBuffers ? readFiles(fileList) : fileList
  // TODO -> RIAPPLICARE RENDERER INVERSI
}

const executePlugins = async (plugins = [], ctx, config = {}) => {
  const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
  ctx.inMemoryFilesMap = _(ctx.inMemoryFiles).keyBy('fileName').value()
  const excludeFilesFromExtractedFileList = genExcludeFilesFromExtractedFileList(ctx)
  const xmlTransformer = genXmlTransformer(ctx)
  const getFilesFromFilesystem = genGetFilesFromFilesystem(ctx)
  const helpers = { excludeFilesFromExtractedFileList, xmlTransformer, getFilesFromFilesystem }
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
