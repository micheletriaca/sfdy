const chalk = require('chalk')
const logger = require('../services/log-service')
const unzipAndPatch = require('./unzipper')
const Sfdc = require('../utils/sfdc-utils')
const { expandDirectoryPatterns, getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const standardPlugins = require('../plugins')
const standardRenderers = require('../renderers').map(x => x.transform)
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const path = require('path')
const { DEFAULT_CLIENT_ID } = require('../utils/constants')
const { getOauth2Options } = require('../utils/auth-utils')
const { getAdapter } = require('../format-adapters')
const globby = require('globby')

module.exports = async ({ loginOpts, basePath, logger: _logger, files, meta, sourceFormat, config }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (_logger) logger.setLogger(_logger)
  let formatAdapter = getAdapter(config, sourceFormat)
  console.time('running time')
  printLogo()
  logger.log(chalk.yellow('(1/3) Logging in salesforce...'))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    oauth2: getOauth2Options(loginOpts, DEFAULT_CLIENT_ID),
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion: (await getPackageXml()).version[0]
  })
  logger.log(chalk.green(`Logged in as ${sfdcConnector.username}!`))
  if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))
  logger.log(chalk.yellow('(2/3) Retrieving metadata...'))
  const getFiles = (files = []) => {
    let hasPar = false
    const res = []
    let item = ''
    for (let i = 0, len = files.length; i < len; i++) {
      if (files[i] === '{') hasPar = true
      if (files[i] === '}') hasPar = false
      if (files[i] !== ',' || hasPar) item += files[i]
      else if (!hasPar) {
        res.push(item)
        item = ''
      }
    }
    if (item) res.push(item)
    return res.map(x => x.trim())
  }
  let specificFiles = getFiles(files)
  let specificMeta = (meta && meta.split(',').map(x => x.trim())) || []
  let sourceComponents
  if (specificFiles.length) {
    logger.log(chalk.yellow('--files specified. Retrieving only specific files...'))
    if (formatAdapter) {
      specificFiles = await globby(expandDirectoryPatterns(specificFiles), { cwd: pathService.getSrcFolder(true) })
      sourceComponents = formatAdapter.resolve(specificFiles)
      specificMeta = formatAdapter.getPackageComponents(sourceComponents).map(x => `${x.type}/${x.fullName}`)
    } else {
      specificFiles = pluginEngine.applyRemappers(specificFiles)
      const packageMapping = await getPackageMapping(sfdcConnector)
      specificFiles = await getListOfSrcFiles(packageMapping, specificFiles, true)
    }
    if (specificFiles.length === 0 || (formatAdapter && specificMeta.length === 0)) {
      logger.log(chalk.yellow('No files to retrieve. Retrieve skipped'))
      return
    }
    logger.log(chalk.yellow('The following files will be retrieved:'))
    logger.log(chalk.grey(specificFiles.join('\n')))
  } else if (specificMeta.length) {
    logger.log(chalk.yellow('--meta specified. Retrieving only specific metadata types...'))
    logger.log(chalk.yellow('The following metadata will be retrieved:'))
    logger.log(chalk.grey(specificMeta.join('\n')))
  }
  const pkgJson = await getPackageXml({
    specificFiles: formatAdapter ? [] : specificFiles,
    specificMeta,
    sfdcConnector
  })
  if (specificFiles.length) logger.log(chalk.yellow('delta package generated'))

  await pluginEngine.registerPlugins(
    [
      ...standardPlugins,
      ...(config.postRetrievePlugins || []),
      ...standardRenderers,
      ...((config.renderers || []).map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).transform))
    ],
    sfdcConnector,
    sfdcConnector.username,
    pkgJson,
    config)

  const packageJsonWithDependencies = await pluginEngine.buildFinalPackageXml(pkgJson, await getPackageXml())
  const retrieveJob = await sfdcConnector.retrieveMetadata(packageJsonWithDependencies)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  logger.log(chalk.green('Retrieve completed!'))
  logger.log(chalk.yellow('(3/3) Unzipping & applying patches...'))
  const zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64')
  await unzipAndPatch(zipBuffer, sfdcConnector, pkgJson, formatAdapter, sourceComponents)
  logger.log(chalk.green('Unzipped!'))
  console.timeEnd('running time')
}
