const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml } = require('../utils/xml-utils')
const globby = require('globby')
const pathService = require('../services/path-service')
const _ = require('exstream.js')
const l = require('lodash')
const { readFiles } = require('../services/file-service')
const { addTypesToPackageFromMeta } = require('../utils/package-utils')

const genExcludeFiles = ctx => patterns => {
  const fileList = Object.keys(ctx.inMemoryFilesMap)
  const matches = typeof patterns === 'string'
    ? multimatch(fileList, patterns)
    : _(fileList).filter(patterns).values()
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
  // TODO -> SE I FILE ARRIVANO DA FILESYSTEM, VA FATTO UNRENDER IN MODO DA NORMALIZZARLI
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
    const buffers = readFiles(notInMemory).map(f => { f.addedInASecondTime = true; return f })
    for (const f of inMemory) buffers.push(ctx.inMemoryFilesMap[f])
    return buffers
  }
}

const genSetMetaCompanions = ctx => async (patterns, callback) => {
  const hasMatches = multimatch(ctx.allMetaInPackage, patterns)
  const metaList = Object.keys(ctx.meta2filesMap)
  if (!hasMatches.length) return
  ctx.metaCompanions = await _(hasMatches)
    .asyncMap(async f => multimatch(metaList, await callback(f)))
    .flatten()
    .uniq()
    .values()

  if (!ctx.metaCompanions.length) return
  ctx.companions = multimatch(ctx.metaCompanions, ['**/*', ...ctx.allMetaInPackage.map(x => '!' + x)])
  ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.metaCompanions)
}

const executePlugins = async (plugins = [], methodName, ctx, config = {}) => {
  const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
  ctx.inMemoryFilesMap = _(ctx.inMemoryFiles).keyBy('fileName').value()
  const excludeFiles = genExcludeFiles(ctx)
  const xmlTransformer = genXmlTransformer(ctx)
  const getFiles = genGetFiles(ctx)
  const helpers = { excludeFiles, xmlTransformer, getFiles }
  await _(plugins).pluck(methodName).filter(p => p).asyncMap(p => p(pCtx, helpers)).values()
}

module.exports = {
  executeBeforeRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
    const setMetaCompanions = genSetMetaCompanions(ctx)
    for (const p of plugins.map(x => x.beforeRetrieve).filter(x => x)) await p(pCtx, { setMetaCompanions })
  },
  executeAfterRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    return executePlugins(plugins, 'afterRetrieve', ctx, config)
  },
  executeBeforeDeployPlugins: async (plugins = [], ctx, config = {}) => {
    return executePlugins(plugins, 'beforeDeploy', ctx, config)
  }
}
