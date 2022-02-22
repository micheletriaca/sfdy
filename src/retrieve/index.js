/* eslint-disable no-multi-spaces */
const { getPackageMapping, buildPackageXmlFromFiles, addTypesToPackageFromMeta, buildMetaMap, getMetadataFromFileName } = require('../utils/package-utils')
const { parseGlobPatterns, saveFiles } = require('../services/file-service')
const loggerService = require('../services/log-service')
const { printLogo } = require('../utils/branding-utils')
// const nativeRequire = require('../utils/native-require')
const pathService = require('../services/path-service')
const { buildXml } = require('../utils/xml-utils')
const pluginEngine = require('../plugin-engine')
const { unzip } = require('../utils/zip-utils')
// const stdRenderers = require('../renderers')
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

const buildFilesMetaMap = (storeIn) => p().asyncMap(async ctx => {
  const files = await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
  ctx[storeIn] = buildMetaMap(files, ctx.packageMapping)
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
  ctx.inMemoryFiles.splice(ctx.inMemoryFiles.length, 0, ...await unzipPromise)
  return ctx
})

const applyBeforeRetrievePlugins = (plugins = [], config) => p().asyncMap(async ctx => {
  await pluginEngine.executeBeforeRetrievePlugins([...stdPlugins, ...plugins], ctx, config)
  return ctx
})

const applyAfterRetrievePlugins = (plugins = [], renderers = [], config) => p().asyncMap(async ctx => {
  // const stdR = stdRenderers.map(x => x.transform)
  // const customR = renderers.map(x => nativeRequire(x).transform)
  await pluginEngine.executeAfterRetrievePlugins([...stdPlugins, ...plugins], ctx, config)
  // await pluginEngine.executePlugins([...stdR, ...customR], ctx, config)
  for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = Buffer.from(buildXml(f.transformed) + '\n')
  return ctx
})

const saveFilesToDisk = () => p().asyncMap(async ctx => {
  const metadataToFilterSet = new Set(ctx.companions)
  await _(ctx.inMemoryFiles)
    .reject(f => f.filteredByPlugin)
    .reject(f => f.fileName === 'package.xml')
    .reject(f => metadataToFilterSet.has(getMetadataFromFileName(f.fileName, ctx.packageMapping)))
    .apply(saveFiles)
  return ctx
})

module.exports = async function retrieve ({ loginOpts, basePath, logger, files, meta, config }) {
  if (basePath) pathService.setBasePath(basePath)
  if (logger) loggerService.setLogger(logger)
  return await _([{
    sfdc: null,             // SFDC connector
    packageMapping: {},     // Mapping between folder names and SFDC Metadata names
    creds: null,            // Credentials object
    filesGlobPatterns: [],  // Patterns of file to be retrieved coming from --files option
    metaGlobPatterns: [],   // Patterns of metadata to be retrieved coming from --meta option
    finalFileList: [],      // Concrete file list coming from filesGlobPatterns evaluation
    metaCompanions: [],     // Additional metadata to be retrieved (needed for profiles and objectTranslations, coming from beforeRetrieve plugins that use setMetaCompanions)
    companions: [],         // metaCompanions minus the meta already present in package.xml. This is needed to avoid extracting to fs the meta added only for convenience
    inMemoryFiles: [],      // Array of unzipped files
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
    .through(buildFilesMetaMap('meta2filesMap'))

    // Computing the list of files from --files glob patterns
    .through(injectGlobPatterns(files, 'filesGlobPatterns'))
    .through(calculateManualFileList())

    // Computing the list of metadata from --meta sfdc patterns
    .through(injectGlobPatterns(meta, 'metaGlobPatterns'))
    // TODO -> validate meta glob

    // Printing the list of files and metadata
    // TODO -> exit if no files logger.log(chalk.yellow('No files to retrieve. Retrieve skipped'))
    .log('The following files/metadata will be retrieved:', 'yellow')
    .log(printFileAndMetadataList)

    // Building package.xml. the member list is a composition of data coming
    // from --files and --meta
    .through(buildPackageXml())

    // Applying before retrieve plugins (to add metadata inter dependencies)
    .through(applyBeforeRetrievePlugins(config.postRetrievePlugins, config))

    // Retrieving from SFDC + unzipping in memory
    .through(retrieveMetadata())
    .log('Retrieve completed!', 'green')
    .log('(3/3) Unzipping & applying patches...', 'yellow')
    .through(unzipper())

    // Applying afterRetrieve plugins
    .through(applyAfterRetrievePlugins(config.postRetrievePlugins, config.renderers, config))

    // TODO -> ALERT IF FILE IS NOT IN SALESFORCE. POSSIBILITY TO CLEAN IT
    .through(saveFilesToDisk()) // TODO -> SAVE ONLY FILES PRESENT IN FILELIST OR IN META LIST
    // TODO -> CALCULATE PACKAGE.XML
    .log('Unzipped!', 'green')
    .tap(x => console.log({
      sfdc: x.sfdc,
      creds: x.creds,
      filesGlobPatterns: x.filesGlobPatterns,
      finalFileList: x.finalFileList,
      inMemoryFiles: x.inMemoryFiles,
      packageJson: JSON.stringify(x.packageJson, null, 2),
      zip: x.zip
    }))
    .values()
}
