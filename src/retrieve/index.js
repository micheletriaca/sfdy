const chalk = require('chalk')
const logger = require('../services/log-service')
const unzipAndPatch = require('./unzipper')
const Sfdc = require('../utils/sfdc-utils')
const { expandDirectoryPatterns, getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const { printLogo } = require('../utils/branding-utils')
const standardPlugins = require('../plugins')
const standardRenderers = require('../renderers')
const pathService = require('../services/path-service')
const { DEFAULT_CLIENT_ID } = require('../utils/constants')
const { getOauth2Options } = require('../utils/auth-utils')
const { getAdapter } = require('../format-adapters')
const globby = require('globby')
const { FileSelection, FileTree, MetadataCollection, MetadataSelection } = require('../plugin')
const { addressesFromPackage } = require('../plugin/selection')
const { planExtensions, resolveSelections } = require('../plugin/runtime')
const { prepareExtensions, warnLegacy } = require('../plugin/loader')
const { readProjectEntries } = require('../plugin/project-files')

module.exports = async ({
  loginOpts,
  basePath,
  logger: _logger,
  files,
  meta,
  components,
  srcFolder,
  sourceFormat,
  config = {}
}) => {
  pathService.configureProject({ basePath, srcFolder, sourceFormat, config })
  if (_logger) logger.setLogger(_logger)
  let formatAdapter = getAdapter(config, sourceFormat)
  console.time('running time')
  printLogo()
  logger.log(chalk.yellow('(1/3) Logging in salesforce...'))
  const apiVersion = pathService.getApiVersion()
  if (!apiVersion) {
    throw new Error('Missing API version. Set apiVersion in .sfdy.json or sourceApiVersion in sfdx-project.json')
  }
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    oauth2: getOauth2Options(loginOpts, DEFAULT_CLIENT_ID),
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion
  })
  logger.log(chalk.green(`Logged in as ${sfdcConnector.username}!`))
  const packageMapping = await getPackageMapping(sfdcConnector)
  if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, packageMapping)
  const localSourceFiles = formatAdapter
    ? await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
    : []
  const localSourceComponents = formatAdapter
    ? formatAdapter.resolve(localSourceFiles.filter(fileName => formatAdapter.isMetadataPath(fileName)))
    : []
  const localPackageComponents = formatAdapter
    ? formatAdapter.getPackageComponents(localSourceComponents)
    : []
  const diskEntries = await readProjectEntries(pathService.getSrcFolder(true))
  const preparedRenderers = prepareExtensions({
    entries: [
      ...(formatAdapter ? [] : standardRenderers),
      ...(config.renderers || [])
    ],
    basePath: pathService.getBasePath(),
    packageJson: {},
    legacyHook: 'transform'
  })
  const preparedPlugins = prepareExtensions({
    entries: config.postRetrievePlugins || [],
    basePath: pathService.getBasePath(),
    packageJson: {}
  })
  warnLegacy(preparedRenderers.legacy, 'Renderer')
  warnLegacy(preparedPlugins.legacy, 'Plugin')
  const storedPackage = formatAdapter
    ? await getPackageXml({
      specificMeta: localPackageComponents.map(x => `${x.type}/${x.fullName}`),
      apiVersion
    })
    : await getPackageXml({ specificFiles: ['**/*'], sfdcConnector, apiVersion })
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
  let sourceComponents = components
  let retrieveLocalInventory = false
  if (specificFiles.length) {
    logger.log(chalk.yellow('--files specified. Retrieving only specific files...'))
    if (formatAdapter) {
      specificFiles = await globby(expandDirectoryPatterns(specificFiles), { cwd: pathService.getSrcFolder(true) })
    }
    const fileSelection = new FileSelection(specificFiles)
    await resolveSelections({
      extensions: [...preparedPlugins.extensions, ...preparedRenderers.extensions],
      selection: fileSelection,
      project: new FileTree({ diskEntries }).project,
      direction: 'retrieve',
      format: formatAdapter ? 'sfdx' : 'metadata',
      target: { environment: process.env.environment, username: sfdcConnector.username },
      sfdcConnector,
      config
    })
    specificFiles = fileSelection.values()
    if (formatAdapter) {
      specificFiles = await globby(expandDirectoryPatterns(specificFiles), { cwd: pathService.getSrcFolder(true) })
      sourceComponents = formatAdapter.resolve(specificFiles)
      specificMeta = formatAdapter.getPackageComponents(sourceComponents).map(x => `${x.type}/${x.fullName}`)
    } else {
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
  } else {
    if (!(storedPackage.types || []).length) {
      throw new Error('No local metadata components found. Use --meta to retrieve components into an empty project')
    }
    retrieveLocalInventory = true
    if (formatAdapter) {
      sourceComponents = localSourceComponents
      specificMeta = localPackageComponents.map(x => `${x.type}/${x.fullName}`)
    }
  }
  const pkgJson = retrieveLocalInventory
    ? storedPackage
    : await getPackageXml({
      specificFiles: formatAdapter ? [] : specificFiles,
      specificMeta,
      sfdcConnector,
      apiVersion
    })
  if (specificFiles.length) logger.log(chalk.yellow('delta package generated'))

  const selection = new MetadataSelection(addressesFromPackage(pkgJson))
  const requestedKeys = new Set(selection.values().map(component => `${component.type}/${component.fullName}`))
  const inventory = new MetadataCollection(addressesFromPackage(storedPackage))
  await planExtensions({
    extensions: standardPlugins,
    selection,
    inventory,
    direction: 'retrieve',
    format: formatAdapter ? 'sfdx' : 'metadata',
    target: { environment: process.env.environment, username: sfdcConnector.username },
    sfdcConnector,
    config
  })
  preparedPlugins.extensions.forEach(extension => extension.setPackage?.(selection.toPackage(pkgJson)))
  await planExtensions({
    extensions: preparedPlugins.extensions,
    selection,
    inventory,
    direction: 'retrieve',
    format: formatAdapter ? 'sfdx' : 'metadata',
    target: { environment: process.env.environment, username: sfdcConnector.username },
    sfdcConnector,
    config
  })
  const packageJsonWithDependencies = selection.toPackage(pkgJson)
  const outputPackage = selection.toOutputPackage(pkgJson)
  const plannedComponents = [...new Map([
    ...(formatAdapter
      ? (sourceComponents || [])
      : (sourceComponents || addressesFromPackage(outputPackage))),
    ...selection.values().filter(component => !requestedKeys.has(`${component.type}/${component.fullName}`))
  ].map(component => [`${component.type}/${component.fullName}`, component])).values()]
  const retrieveJob = await sfdcConnector.retrieveMetadata(packageJsonWithDependencies)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  logger.log(chalk.green('Retrieve completed!'))
  logger.log(chalk.yellow('(3/3) Unzipping & applying patches...'))
  const zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64')
  await unzipAndPatch(zipBuffer, sfdcConnector, outputPackage, formatAdapter, plannedComponents, {
    plugins: preparedPlugins.extensions,
    metadataPlugins: [...standardPlugins, ...preparedPlugins.extensions],
    renderers: preparedRenderers.extensions,
    config,
    retrievePackage: packageJsonWithDependencies
  })
  logger.log(chalk.green('Unzipped!'))
  console.timeEnd('running time')
}
