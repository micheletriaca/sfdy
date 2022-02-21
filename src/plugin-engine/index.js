const multimatch = require('multimatch')
const logger = require('../services/log-service')

const genApplyMaskToExtractedFileList = ctx => patterns => {
  const matches = new Set(multimatch(ctx.inMemoryFiles.map(x => x.fileName), patterns))
  ctx.inMemoryFiles.forEach(f => { if (!matches[f]) f.filteredByPlugin = true })
}

const executePlugins = async (plugins = [], ctx, config = {}) => {
  const pCtx = { env: process.env.environment, log: logger.log, config }
  const applyMaskToExtractedFileList = genApplyMaskToExtractedFileList(ctx)
  const helpers = { applyMaskToExtractedFileList }
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
