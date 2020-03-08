
const chalk = require('chalk')
const log = require('../services/log-service').getLogger()
const unzipAndPatch = require('./unzipper')
const Sfdc = require('../utils/sfdc-utils')
const logService = require('../services/log-service')
const { getProfileOnlyPackage, getPackageXml } = require('../utils/package-utils')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const standardPlugins = require('../plugins')
const pathService = require('../services/path-service')

module.exports = async ({ loginOpts, basePath, logger, profileOnly, files, meta, config }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (logger) logService.setLogger(logger)
  console.time('running time')
  printLogo()
  log(chalk.yellow(`(1/3) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion: (await getPackageXml()).version[0]
  })
  log(chalk.green(`Logged in!`))

  log(chalk.yellow(`(2/3) Retrieving metadata...`))
  if (profileOnly) log(chalk.yellow(`--profile-only=true. Retrieving profiles only...`))
  const specificFiles = (files && files.split(',').map(x => x.trim())) || []
  const specificMeta = (meta && meta.split(',').map(x => x.trim())) || []
  if (specificFiles.length) log(chalk.yellow(`--files specified. Retrieving only specific files...`))
  else if (specificMeta.length) log(chalk.yellow(`--meta specified. Retrieving only specific metadata types...`))
  const pkgJson = await (
    profileOnly
      ? getProfileOnlyPackage()
      : getPackageXml({
        specificFiles,
        specificMeta,
        sfdcConnector
      })
  )
  if (specificFiles.length) log(chalk.yellow(`delta package generated`))

  await pluginEngine.registerPlugins(
    [...standardPlugins, ...config.postRetrievePlugins],
    sfdcConnector,
    loginOpts.username,
    pkgJson,
    config)

  const retrieveJob = await sfdcConnector.retrieveMetadata(pkgJson)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  log(chalk.green(`Retrieve completed!`))
  log(chalk.yellow(`(3/3) Unzipping & applying patches...`))
  const zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64')
  await unzipAndPatch(zipBuffer, sfdcConnector)
  log(chalk.green(`Unzipped!`))
  console.timeEnd('running time')
}
