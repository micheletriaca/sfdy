
const chalk = require('chalk')
const logger = require('../services/log-service')
const unzipAndPatch = require('./unzipper')
const Sfdc = require('../utils/sfdc-utils')
const { getPackageXml } = require('../utils/package-utils')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const standardPlugins = require('../plugins')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const path = require('path')

module.exports = async ({ loginOpts, basePath, logger: _logger, files, meta, config }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (_logger) logger.setLogger(_logger)
  console.time('running time')
  printLogo()
  logger.log(chalk.yellow(`(1/3) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion: (await getPackageXml()).version[0]
  })
  logger.log(chalk.green(`Logged in!`))

  logger.log(chalk.yellow(`(2/3) Retrieving metadata...`))
  const specificFiles = (files && files.split(',').map(x => x.trim())) || []
  const specificMeta = (meta && meta.split(',').map(x => x.trim())) || []
  if (specificFiles.length) logger.log(chalk.yellow(`--files specified. Retrieving only specific files...`))
  else if (specificMeta.length) logger.log(chalk.yellow(`--meta specified. Retrieving only specific metadata types...`))
  const pkgJson = await getPackageXml({
    specificFiles,
    specificMeta,
    sfdcConnector
  })
  if (specificFiles.length) logger.log(chalk.yellow(`delta package generated`))

  await pluginEngine.registerPlugins(
    [
      ...standardPlugins,
      ...(config.postRetrievePlugins || []),
      ...((config.renderers || []).map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).transform))
    ],
    sfdcConnector,
    loginOpts.username,
    pkgJson,
    config)

  const packageJsonWithDependences = await pluginEngine.buildFinalPackageXml(pkgJson, await getPackageXml())
  const retrieveJob = await sfdcConnector.retrieveMetadata(packageJsonWithDependences)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  logger.log(chalk.green(`Retrieve completed!`))
  logger.log(chalk.yellow(`(3/3) Unzipping & applying patches...`))
  const zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64')
  await unzipAndPatch(zipBuffer, sfdcConnector, pkgJson)
  logger.log(chalk.green(`Unzipped!`))
  console.timeEnd('running time')
}
