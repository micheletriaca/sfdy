const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml, buildXml } = require('../utils/xml-utils')
const globby = require('globby')
const pathService = require('../services/path-service')
const _ = require('exstream.js')
const l = require('lodash')
const { readFiles } = require('../services/file-service')
const { addTypesToPackageFromMeta } = require('../utils/package-utils')
const del = require('del')
const nativeRequire = require('../utils/native-require')

const genExcludeFilesWhen = ctx => patterns => {
  const fileList = Object.keys(ctx.inMemoryFilesMap)
  const matches = typeof patterns === 'string' || Array.isArray(patterns)
    ? multimatch(fileList, patterns)
    : _(fileList).filter(patterns).values()
  matches.forEach(m => { ctx.inMemoryFilesMap[m].filteredByPlugin = true })
  if (ctx.deploy) ctx.finalFileList = ctx.finalFileList.filter(x => !ctx.inMemoryFilesMap[x].filteredByPlugin)
}

const upsert = (arr, vals) => {
  vals = Array.isArray(vals) ? vals : [vals]
  for (const val of vals) {
    const valIdx = arr.indexOf(val)
    if (valIdx !== -1) arr.splice(valIdx, 1, val)
    else arr.push(val)
  }
  arr.sort()
}

const genIncludeFiles = ctx => files => {
  for (const f of files) {
    f.includedByPlugin = true
    const alreadyPresent = !!ctx.inMemoryFilesMap[f.fileName]
    ctx.inMemoryFilesMap[f.fileName] = f
    if (!alreadyPresent) ctx.inMemoryFiles.push(f)
    else ctx.inMemoryFiles.splice(ctx.inMemoryFiles.findIndex(x => x.fileName === f.fileName), 1, f)
    if (ctx.deploy) upsert(ctx.finalFileList, f.fileName)
  }
}

const genRemoveFilesFromFilesystem = () => async files => {
  await del([...files], {
    cwd: pathService.getSrcFolder(true)
  })
}

const genXmlTransformer = ctx => async (patterns, callback) => {
  const matches = multimatch(Object.keys(ctx.inMemoryFilesMap), patterns)
  for (const m of matches) {
    const f = ctx.inMemoryFilesMap[m]
    f.transformed = f.transformed || await parseXml(f.data)
    await callback(f.fileName, Object.values(f.transformed)[0])
  }
}

const genGetFiles = ctx => async (patterns, readBuffers = true, fromFilesystem = true, fromMemory = true) => {
  // TODO -> SE I FILE ARRIVANO DA FILESYSTEM, VA FATTO UNRENDER IN MODO DA NORMALIZZARLI
  const fileList = fromFilesystem ? await globby(patterns, { cwd: pathService.getSrcFolder(true) }) : []
  const fileListInMemory = fromMemory ? multimatch(Object.keys(ctx.inMemoryFilesMap), patterns) : []
  const wholeFileList = [...new Set([...fileList, ...fileListInMemory])]
  if (!readBuffers) {
    return wholeFileList
  } else if (readBuffers) {
    const notInMemory = l.difference(fileList, fileListInMemory)
    const inMemory = wholeFileList.filter(f => ctx.inMemoryFilesMap[f])
    const buffers = readFiles(notInMemory).map(f => { f.addedInASecondTime = true; return f })
    for (const f of inMemory) buffers.push(ctx.inMemoryFilesMap[f])
    return buffers
  }
}

const genSetMetaCompanions = ctx => async (patterns, callback, onlyVersioned = true) => {
  const hasMatches = multimatch(ctx.allMetaInPackage, patterns)
  if (!hasMatches.length) return

  if (!onlyVersioned) {
    ctx.companions = ctx.metaCompanions = await _(patterns).asyncMap(async f => callback(f)).flatten().uniq().values()
    ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.metaCompanions)
  } else {
    const metaList = Object.keys(ctx.meta2filesMap)
    ctx.metaCompanions = await _(hasMatches)
      .asyncMap(async f => multimatch(metaList, await callback(f)))
      .flatten()
      .uniq()
      .values()

    if (!ctx.metaCompanions.length) return
    if (!onlyVersioned) ctx.companions = ctx.metaCompanions
    else ctx.companions = multimatch(ctx.metaCompanions, ['**/*', ...ctx.allMetaInPackage.map(x => '!' + x)])
    ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.metaCompanions)
  }
}

const genRemap = (ctx, getFiles, includeFiles) => async (inputPatterns, outputPatternFn) => {
  const inputFiles = await _(getFiles(inputPatterns, false, false))
    .flatten()
    .map(outputPatternFn)
    .uniq()
    .values()

  const outputFileBuffers = await getFiles(inputFiles)
  await includeFiles(outputFileBuffers)
}

const executePlugins = async (plugins = [], methodName, ctx, config = {}) => {
  const pL = requireCustomPlugins(plugins)
  const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
  ctx.inMemoryFilesMap = _(ctx.inMemoryFiles).keyBy('fileName').value()
  const excludeFilesWhen = genExcludeFilesWhen(ctx)
  const includeFiles = genIncludeFiles(ctx)
  const xmlTransformer = genXmlTransformer(ctx)
  const getFiles = genGetFiles(ctx)
  const remap = genRemap(ctx, getFiles, includeFiles)
  const includeInList = async files => {
    upsert(ctx.finalFileList, files)
    await getFiles(ctx.finalFileList)
  }
  const removeFilesFromFilesystem = genRemoveFilesFromFilesystem(ctx)
  const helpers = {
    remap,
    excludeFilesWhen,
    includeFiles,
    xmlTransformer,
    getFiles,
    removeFilesFromFilesystem,
    includeInList
  }
  await _(pL).pluck(methodName).filter(p => p).asyncMap(p => p(pCtx, helpers)).values()
}

const requireCustomPlugins = plugins => {
  return plugins.map(p => {
    if (typeof p === 'string') return nativeRequire(p)
    else return p
  })
}

module.exports = {
  executeBeforeRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    const pL = requireCustomPlugins(plugins)
    const pCtx = { env: process.env.environment, log: logger.log, config, sfdc: ctx.sfdc }
    const setMetaCompanions = genSetMetaCompanions(ctx)
    for (const p of pL.map(x => x.beforeRetrieve).filter(x => x)) await p(pCtx, { setMetaCompanions })
  },
  executeAfterRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'afterRetrieve', ctx, config)
    for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = Buffer.from(buildXml(f.transformed) + '\n')
  },
  executeBeforeDeployPlugins: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'beforeDeploy', ctx, config)
    for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = Buffer.from(buildXml(f.transformed) + '\n')
  },
  executeRenderersTransformations: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'transform', ctx, config)
    for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = Buffer.from(buildXml(f.transformed) + '\n')
  },
  executeRenderersNormalizations: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'normalize', ctx, config)
    for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = Buffer.from(buildXml(f.transformed) + '\n')
  }

}
