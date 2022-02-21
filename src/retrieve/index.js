
const { getPackageMapping, buildPackageXmlFromFiles, addTypesToPackageFromMeta } = require('../utils/package-utils')
const { parseGlobPatterns, saveFiles } = require('../services/file-service')
const stdRenderers = require('../renderers')
const loggerService = require('../services/log-service')
const { printLogo } = require('../utils/branding-utils')
const nativeRequire = require('../utils/native-require')
const pathService = require('../services/path-service')
const { buildXml } = require('../utils/xml-utils')
const pluginEngine = require('../plugin-engine')
const Sfdc = require('../utils/sfdc-utils')
const { unzip } = require('../utils/zip-utils')
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
  if (ctx.metaGlobPatterns.length) ctx.packageJson = addTypesToPackageFromMeta(ctx.packageJson, ctx.metaGlobPatterns)
  return ctx
})

const printFileAndMetadataList = ctx => {
  let res = ''
  if (ctx.finalFileList.length) res = res.concat(['Files:\n']).concat(ctx.finalFileList.join('\n') + '\n')
  if (ctx.metaGlobPatterns.length) res = res.concat(['Metadata:\n']).concat(ctx.metaGlobPatterns.join('\n'))
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
  const unzipPromise = unzip(ctx.zip)
  delete ctx.zip // free memory
  ctx.inMemoryFiles.splice(ctx.inMemoryFiles.length, 0, ...await unzipPromise)
  return ctx
})

const applyPlugins = (postRetrievePlugins = [], renderers = [], config) => p().asyncMap(async ctx => {
  const stdR = stdRenderers.map(x => x.transform)
  const customR = renderers.map(x => nativeRequire(x).transform)
  await pluginEngine.executePlugins([...stdPlugins, ...postRetrievePlugins], ctx, config)
  await pluginEngine.executePlugins([...stdR, ...customR], ctx, config)
  for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = buildXml(f.transformed) + '\n'
  return ctx
})

const saveFilesToDisk = () => p().asyncMap(async ctx => {
  await saveFiles(ctx.inMemoryFiles)
  return ctx
})

module.exports = async function retrieve ({ loginOpts, basePath, logger, files, meta, config }) {
  if (basePath) pathService.setBasePath(basePath)
  if (logger) loggerService.setLogger(logger)
  return await _([{
    sfdc: null,
    packageMapping: {},
    creds: null,
    filesGlobPatterns: [],
    metaGlobPatterns: [],
    finalFileList: [],
    inMemoryFiles: [],
    packageJson: null,
    zip: null
  }])
    .tap(printLogo)
    .log(`(1/3) Logging in salesforce as ${loginOpts.username}...`, 'yellow')
    .through(injectSfdc(loginOpts))
    .log('Logged in!', 'green')
    .log('(2/3) Retrieving metadata...', 'yellow')
    .through(injectGlobPatterns(files, 'filesGlobPatterns'))
    .through(calculateManualFileList())
    // TODO -> REMAPPERS
    .through(injectGlobPatterns(meta, 'metaGlobPatterns'))
    // TODO -> validate meta glob
    // TODO -> exit if no files logger.log(chalk.yellow('No files to retrieve. Retrieve skipped'))
    .log('The following files/metadata will be retrieved:', 'yellow')
    .log(printFileAndMetadataList)
    .through(buildPackageXml())
    .through(retrieveMetadata())
    .log('Retrieve completed!', 'green')
    .log('(3/3) Unzipping & applying patches...', 'yellow')
    .through(unzipper())
    .through(applyPlugins(config.postRetrievePlugins, config.renderers, config))
    // TODO -> ALERT IF FILE IS NOT IN SALESFORCE. POSSIBILITY TO CLEAN IT
    .through(saveFilesToDisk()) // TODO -> SAVE ONLY FILES PRESENT IN FILELIST OR IN META LIST
    // TODO -> NOT OVERWRITE PACKAGE XML
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
