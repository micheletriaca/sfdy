const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml, buildXml } = require('../utils/xml-utils')
const globby = require('globby')
const pathService = require('../services/path-service')
const _ = require('exstream.js')
const l = require('lodash')
const { readFiles } = require('../services/file-service')
const { addTypesToPackageFromMeta, removeTypeFromPackage } = require('../utils/package-utils')
const del = require('del')
const nativeRequire = require('../utils/native-require')

const genExcludeFilesWhen = ctx => patterns => {
  const fileList = Object.keys(ctx.inMemoryFilesMap).concat(ctx.finalFileList)
  const matches = typeof patterns === 'string' || Array.isArray(patterns)
    ? multimatch(fileList, patterns)
    : _(fileList).filter(patterns).values()
  matches.filter(m => !!ctx.inMemoryFilesMap[m]).forEach(m => { ctx.inMemoryFilesMap[m].filteredByPlugin = true })
  ctx.finalFileList = ctx.finalFileList.filter(x => !matches.includes(x))
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
    ctx.inMemoryFilesMap[f.fileName] = f
    upsert(ctx.finalFileList, f.fileName)
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

const genXmlParser = ctx => async (patterns, callback) => {
  const matches = multimatch(Object.keys(ctx.inMemoryFilesMap), patterns)
  for (const m of matches) {
    const f = ctx.inMemoryFilesMap[m]
    await callback(f.fileName, Object.values(await parseXml(f.data))[0])
  }
}

const genGetFiles = (ctx, count = 0) => async (patterns, readBuffers = true, fromFilesystem = true, fromMemory = true) => {
  // TODO -> SE I FILE ARRIVANO DA FILESYSTEM, VA FATTO UNRENDER IN MODO DA NORMALIZZARLI
  const timeSpan = '--> getFiles' + (count++)
  logger.time(timeSpan)
  try {
    const fileList = fromFilesystem ? await globby(patterns, { cwd: pathService.getSrcFolder(true) }) : []
    const allFilesInMemory = readBuffers ? Object.keys(ctx.inMemoryFilesMap) : ctx.finalFileList
    const fileListInMemory = fromMemory ? multimatch(allFilesInMemory, patterns) : []
    const wholeFileList = [...new Set([...fileList, ...fileListInMemory])]
    if (!readBuffers) {
      return wholeFileList
    } else if (readBuffers) {
      const notInMemory = l.difference(fileList, fileListInMemory)
      const inMemory = fromMemory ? wholeFileList.filter(f => ctx.inMemoryFilesMap[f]) : []
      const buffers = readFiles(notInMemory).map(f => { f.addedInASecondTime = true; return f })
      for (const f of inMemory) buffers.push(ctx.inMemoryFilesMap[f])
      return buffers
    }
  } finally {
    logger.timeEnd(timeSpan)
  }
}

const genSetMetaCompanions = ctx => async (patterns, callback, onlyVersioned = true) => {
  // TODO -> CHE SUCCEDE SE CHIAMO STO METODO TANTE VOLTE? LA LISTA DI METACOMPANIONS PRECEDENTE SI RESETTA?
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

const genRemap = (ctx, getFiles, includeFiles, excludeFilesWhen) => async (inputPatterns, outputPatternFn) => {
  const remappedFiles = await _(getFiles(inputPatterns, false, false))
    .flatten()
    .flatMap(outputPatternFn)
    .uniq()
    .values()

  const outputFileBuffers = await _(getFiles(remappedFiles)).flatten().keyBy('fileName').value()
  excludeFilesWhen(inputPatterns)
  await _(remappedFiles)
    .map(f => outputFileBuffers[f] || { fileName: f, data: Buffer.alloc(0) })
    .apply(includeFiles)
}

const genAddToPackage = ctx => (metaName, metaMember) => {
  upsert(ctx.scheduledAddToPackage, metaName + '/' + metaMember)
}

const genRemoveFromPackage = ctx => (metaName, metaMember) => {
  upsert(ctx.scheduledRemoveFromPackage, { metaName, metaMember })
}

const requireCustomPlugins = plugins => {
  return plugins.map(p => {
    if (typeof p === 'string') return nativeRequire(p)
    else return p
  })
}

const checkEnabled = config => p => p.isEnabled == null || p.isEnabled(config)

const executePlugins = async (plugins = [], methodName, ctx, config = {}) => {
  const pL = requireCustomPlugins(plugins)
  const pCtx = { env: process.env.environment, log: logger.log, logger, config, sfdc: ctx.sfdc, _raw: ctx }
  const excludeFilesWhen = genExcludeFilesWhen(ctx)
  const xmlTransformer = genXmlTransformer(ctx)
  const xmlParser = genXmlParser(ctx)
  const includeFiles = genIncludeFiles(ctx)
  const getFiles = genGetFiles(ctx)
  const remap = genRemap(ctx, getFiles, includeFiles)
  const addToPackage = genAddToPackage(ctx)
  const removeFromPackage = genRemoveFromPackage(ctx)
  const removeFilesFromFilesystem = genRemoveFilesFromFilesystem(ctx)
  const helpers = {
    remap,
    addToPackage,
    removeFromPackage,
    excludeFilesWhen,
    includeFiles,
    xmlTransformer,
    xmlParser,
    getFiles,
    removeFilesFromFilesystem
  }
  await _(pL).filter(checkEnabled(config)).pluck(methodName).filter(p => p).asyncMap(p => p(pCtx, helpers)).values()
}

const rebuildBinaries = ctx => {
  logger.time('rebuilding binaries')
  for (const f of Object.values(ctx.inMemoryFilesMap).filter(x => !!x.transformed)) {
    f.data = Buffer.from(buildXml(f.transformed) + '\n')
    delete f.transformed
  }
  logger.timeEnd('rebuilding binaries')
}

module.exports = {
  requireCustomPlugins,
  executeBeforeRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    const pL = requireCustomPlugins(plugins)
    const pCtx = { env: process.env.environment, log: logger.log, logger, config, sfdc: ctx.sfdc }
    const setMetaCompanions = genSetMetaCompanions(ctx)
    for (const p of pL.filter(checkEnabled(config)).map(x => x.beforeRetrieve).filter(x => x)) await p(pCtx, { setMetaCompanions })
  },
  executeAfterRetrievePlugins: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'afterRetrieve', ctx, config)
    rebuildBinaries(ctx)
  },
  executeBeforeDeployPlugins: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'beforeDeploy', ctx, config)
    rebuildBinaries(ctx)
  },
  executeRenderersTransformations: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'transform', ctx, config)
    rebuildBinaries(ctx)
  },
  executeRenderersNormalizations: async (plugins = [], ctx, config = {}) => {
    await executePlugins(plugins, 'normalize', ctx, config)
    rebuildBinaries(ctx)
  },
  executeRenderersPackagePatch: (ctx) => {
    for (const p of ctx.scheduledRemoveFromPackage) {
      ctx.packageJson = removeTypeFromPackage(ctx.packageJson, p.metaName, p.metaMember)
    }
    ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.scheduledAddToPackage)
  },
  executeRemap: async (plugins = [], ctx, config) => {
    const includeFiles = genIncludeFiles(ctx)
    const getFiles = genGetFiles(ctx)
    const excludeFilesWhen = genExcludeFilesWhen(ctx)
    const remap = genRemap(ctx, getFiles, includeFiles, excludeFilesWhen)
    const pL = requireCustomPlugins(plugins)
    for (const p of pL.filter(checkEnabled(config)).map(x => x.remaps).flat().filter(x => x)) {
      await remap(p.transformed, p.normalized)
    }
  }
}
