/* eslint-disable no-multi-spaces */
const { getPackageMapping, buildPackageXmlFromFiles, addTypesToPackageFromMeta, buildMetaMap, getMetadataFromFileName, getChildXmlMap } = require('../utils/package-utils')
const { parseGlobPatterns, saveFiles } = require('../services/file-service')
const { requireCustomPlugins } = require('../plugin-engine')
const loggerService = require('../services/log-service')
const { printLogo } = require('../utils/branding-utils')
const pathService = require('../services/path-service')
const pluginEngine = require('../plugin-engine')
const { unzip } = require('../utils/zip-utils')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const stdPlugins = require('../plugins')
const _ = require('../utils/exstream')
const globby = require('globby')

const p = _.pipeline

const injectSfdc = creds => p().asyncMap(async ctx => {
  ctx.sfdc = await Sfdc.newInstance(creds)
  ctx.packageMapping = await getPackageMapping(ctx.sfdc)
  ctx.creds = creds
  return ctx
})

const injectGlobPatterns = (patternString = '', storeIn) => p().map(ctx => {
  ctx[storeIn] = parseGlobPatterns(patternString)
  return ctx
})

const calculateManualFileList = () => p().asyncMap(async ctx => {
  if (!ctx.filesGlobPatterns.length) return ctx
  ctx.finalFileList = await globby(ctx.filesGlobPatterns, { cwd: pathService.getSrcFolder(true) })
  return ctx
})

const buildPackageXml = () => p().map(ctx => {
  ctx.packageJson = buildPackageXmlFromFiles(ctx.finalFileList, ctx.packageMapping, ctx.sfdc.apiVersion)
  const packageMetaMap = buildMetaMap(ctx.finalFileList, ctx.packageMapping)
  ctx.allMetaInPackage = [...new Set(Object.keys(packageMetaMap).concat(ctx.metaGlobPatterns))]
  if (ctx.metaGlobPatterns.length) ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.metaGlobPatterns)
  return ctx
})

const buildFilesMetaMap = (storeIn, renderers, config) => p().asyncMap(async ctx => {
  loggerService.time('buildFilesMetaMap')
  renderers = requireCustomPlugins([...stdRenderers, ...renderers])
  renderers = renderers
    .filter(x => x.isEnabled && x.isEnabled(config))
    .map(x => x.metadataRemaps)
    .filter(x => x)
    .flat()
  const files = await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
  ctx[storeIn] = buildMetaMap(files, ctx.packageMapping, renderers)
  loggerService.timeEnd('buildFilesMetaMap')
  return ctx
})

const printFileAndMetadataList = ctx => {
  let res = ''
  if (ctx.finalFileList.length) res = res.concat(['Files:\n']).concat(ctx.finalFileList.join('\n') + '\n')
  if (ctx.metaGlobPatterns.length) res = res.concat(['Metadata:\n']).concat(ctx.metaGlobPatterns.join('\n') + '\n')
  return res
}

const retrieveMetadata = () => p().asyncMap(async (ctx) => {
  ctx.retrieveJob = await ctx.sfdc.retrieveMetadata(ctx.packageJson.Package)
  ctx.retrieveResult = await ctx.sfdc.pollRetrieveMetadataStatus(ctx.retrieveJob.id)
  ctx.zip = Buffer.from(ctx.retrieveResult.zipFile, 'base64')
  delete ctx.retrieveResult.zipFile // free memory
  return ctx
})

const unzipper = () => p().asyncMap(async ctx => {
  const unzipPromise = unzip(ctx.zip, ctx.companions, ctx.packageMapping)
  delete ctx.zip // free memory
  await _(unzipPromise).flatten().tap(x => { ctx.inMemoryFilesMap[x.fileName] = x }).toPromise()
  return ctx
})

const applyBeforeRetrievePlugins = (plugins = [], config) => p().asyncMap(async ctx => {
  await pluginEngine.executeBeforeRetrievePlugins([...stdPlugins, ...plugins], ctx, config)
  return ctx
})

const applyAfterRetrievePlugins = (plugins = [], config) => p().asyncMap(async ctx => {
  await pluginEngine.executeAfterRetrievePlugins([...stdPlugins, ...plugins], ctx, config)
  return ctx
})

const applyRemaps = (renderers = [], config) => p().asyncMap(async ctx => {
  await pluginEngine.executeRemap([...stdRenderers, ...renderers], ctx, config)
  return ctx
})

const applyRenderers = (renderers = [], config) => p().asyncMap(async ctx => {
  await pluginEngine.executeRenderersTransformations([...stdRenderers, ...renderers], ctx, config)
  return ctx
})

const saveFilesToDisk = () => p().asyncMap(async ctx => {
  const metadataToFilterSet = new Set(ctx.companions)
  const isNotInOriginalPackage = f => metadataToFilterSet.has(getMetadataFromFileName(f, ctx.packageMapping))
  const conflictLogger = f => {
    if (f.includedByPlugin && f.filteredByPlugin) {
      return 'WARNING: plugin conflict. One plugin has added a file, another one has removed it: ' + f.fileName
    }
  }

  await _(Object.values(ctx.inMemoryFilesMap))
    .log(conflictLogger)
    .reject(f => f.filteredByPlugin)
    .reject(f => f.fileName === 'package.xml')
    .reject(f => !f.includedByPlugin && isNotInOriginalPackage(f.fileName))
    .apply(saveFiles)
  return ctx
})

module.exports = async function retrieve (opts) {
  const { loginOpts, basePath, logger, files, meta, config, srcFolder } = opts
  if (basePath) pathService.setBasePath(basePath)
  if (logger) loggerService.setLogger(logger)
  if (srcFolder) pathService.setSrcFolder(srcFolder)
  const s1 = _([{
    retrieve: true,
    sfdc: null,             // SFDC connector
    packageMapping: {},     // Mapping between folder names and SFDC Metadata names
    creds: null,            // Credentials object
    filesGlobPatterns: [],  // Patterns of file to be retrieved coming from --files option
    metaGlobPatterns: [],   // Patterns of metadata to be retrieved coming from --meta option
    finalFileList: [],      // Concrete file list coming from filesGlobPatterns evaluation
    metaCompanions: [],     // Additional metadata to be retrieved (needed for profiles and objectTranslations, coming from beforeRetrieve plugins that use setMetaCompanions)
    companions: [],         // metaCompanions minus the meta already present in package.xml. This is needed to avoid extracting to fs the meta added only for convenience
    inMemoryFilesMap: {},   // fileName => {fileName, data} object. Data is coming from unzipped file and plugins
    allMetaInPackage: [],   // finalFileList converted in package.xml metadata list
    packageJson: null,      // JSON object containing generated package.xml
    zip: null,              // Temporary variable to store zip buffer retrieved from salesforce
    meta2filesMap: {},      // Map containing ALL metadataName => list of file that maps to that metadata
    retrieveJob: null,      // SFDC retrieve job
    retrieveResult: null    // SFDC retrieve result
  }])
    .tap(printLogo)
    .log(`(1/3) Logging in salesforce as ${loginOpts.username}...`, 'yellow')
    .through(injectSfdc(loginOpts))
    .log('Logged in!', 'green')
    .log('(2/3) Retrieving metadata...', 'yellow')

    // Building a map  metadata => [filenames] containing all src files
    // This is needed for adding additional metadata to package if we ask for profiles or objectTraslations
    // (whose content depends by the metadata present in package.xml)
    .through(buildFilesMetaMap('meta2filesMap', config.renderers, config))

    // Computing the list of files from --files glob patterns
    .through(injectGlobPatterns(files, 'filesGlobPatterns'))
    .through(calculateManualFileList())

    // Computing the list of metadata from --meta sfdc patterns
    .through(injectGlobPatterns(meta, 'metaGlobPatterns'))
    // TODO -> validate meta glob

    // Computing renderers remaps
    .through(applyRemaps(config.plugins, config))

    // Building package.xml. the member list is a composition of data coming
    // from --files and --meta
    .through(buildPackageXml())

    // Applying before retrieve plugins (to add metadata inter dependencies)
    .through(applyBeforeRetrievePlugins(config.plugins, config))

  const forks = [
    s1.fork()
      .filter(ctx => ctx.finalFileList.length === 0 && ctx.metaGlobPatterns.length === 0)
      .log('No files or metadata to retrieve. Retrieve skipped', 'green')
      .map(() => ({ status: 'Succeeded' })),

    s1.fork()
      .filter(ctx => ctx.finalFileList.length || ctx.metaGlobPatterns.length)

      // Printing the list of files and metadata
      .log('The following files/metadata will be retrieved:', 'yellow')
      .log(printFileAndMetadataList)

      // Retrieving from SFDC + unzipping in memory
      .through(retrieveMetadata())
      .log('Retrieve completed!', 'green')
      .log('(3/3) Unzipping & applying patches...', 'yellow')
      .through(unzipper())

      // Applying afterRetrieve plugins
      .through(applyAfterRetrievePlugins(config.plugins, config))
      .through(applyRenderers(config.renderers, config))

      // Saving data to disk
      // TODO -> ALERT IF FILE IS NOT IN SALESFORCE. POSSIBILITY TO CLEAN IT
      .through(saveFilesToDisk())
      // TODO -> CALCULATE PACKAGE.XML

      .log('Unzipped!', 'green')
  ]

  return _(forks).merge().value()
}
