#!/usr/bin/env node

const { program } = require('commander')
const logger = require('./services/log-service')
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const Sfdc = require('./utils/sfdc-utils')
const configService = require('./services/config-service')
const { getPackageXml, getPackageMapping } = require('./utils/package-utils')
const pathService = require('./services/path-service')
const standardPlugins = require('./plugins')
const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { addAuthenticationOptions, configureAuthentication, getOauth2Options } = require('./utils/auth-utils')
const { getAdapter } = require('./format-adapters')
const { FileTree } = require('./plugin')
const { runExtensions } = require('./plugin/runtime')
const { prepareExtensions, warnLegacy } = require('./plugin/loader')
const { readProjectEntries, writeProjectEntries } = require('./plugin/project-files')

require('./error-handling')()

addAuthenticationOptions(program)
  .option('--skip-untransform', 'Skip untransform phase')
  .parse(process.argv)

const options = configureAuthentication(program.opts())

const config = configService.getConfig()

;(async () => {
  console.time('running time')
  printLogo()

  logger.log(chalk.yellow('(1/2) Logging in salesforce...'))
  pathService.configureProject({ config })
  const apiVersion = pathService.getApiVersion()
  if (!apiVersion) throw new Error('Missing API version. Set apiVersion in .sfdy.json')
  let formatAdapter = getAdapter(config)
  const sfdcConnector = await Sfdc.newInstance({
    username: options.username,
    password: options.password,
    oauth2: getOauth2Options(options, DEFAULT_CLIENT_ID),
    serverUrl: options.serverUrl,
    isSandbox: !!options.sandbox,
    apiVersion
  })
  if (formatAdapter) formatAdapter = getAdapter(config, undefined, await getPackageMapping(sfdcConnector))
  logger.log(chalk.green('Logged in!'))
  logger.log(chalk.yellow('(2/2) Applying patches...'))

  const sourceFolder = pathService.getSrcFolder(true)
  const diskEntries = await readProjectEntries(sourceFolder)
  const fileNames = diskEntries.map(file => file.fileName)
  const packageXml = formatAdapter
    ? await getPackageXml({
      specificMeta: formatAdapter.getPackageComponents(formatAdapter.resolve(
        fileNames.filter(fileName => formatAdapter.isMetadataPath(fileName))
      )).map(component => `${component.type}/${component.fullName}`),
      apiVersion
    })
    : await getPackageXml({
      specificFiles: fileNames,
      sfdcConnector,
      skipParseGlobPatterns: true,
      apiVersion
    })

  const prepare = (entries, legacyHook) => prepareExtensions({
    entries,
    basePath: pathService.getBasePath(),
    packageJson: packageXml,
    legacyHook
  })
  const rendererEntries = config.renderers || []
  const deployRenderers = options.skipUntransform ? { extensions: [], legacy: [] } : prepare(rendererEntries, 'untransform')
  const retrieveRenderers = prepare(rendererEntries, 'transform')
  const plugins = prepare(config.postRetrievePlugins || [])
  warnLegacy([...deployRenderers.legacy, ...retrieveRenderers.legacy], 'Renderer')
  warnLegacy(plugins.legacy, 'Plugin')

  let projectTree = new FileTree({ diskEntries, files: diskEntries, origin: 'disk' })
  const run = (extensions, direction, stage = 'project', fileTree = projectTree) => runExtensions({
    extensions,
    fileTree,
    direction,
    stage,
    format: formatAdapter ? 'sfdx' : 'metadata',
    target: { environment: process.env.environment, username: sfdcConnector.username },
    sfdcConnector,
    config
  })
  await run(deployRenderers.extensions, 'deploy')
  let metadataTree = projectTree
  let converted
  if (formatAdapter) {
    converted = await formatAdapter.toMetadata(projectTree.entries())
    metadataTree = new FileTree({ files: converted.entries })
  }
  await run(standardPlugins, 'retrieve', 'metadata', metadataTree)
  await run(plugins.extensions, 'retrieve', 'metadata', metadataTree)
  if (formatAdapter) {
    const formatted = await formatAdapter.toSource(metadataTree.entries(), {
      components: converted.components,
      existingFiles: fileNames
    })
    projectTree = new FileTree({ diskEntries, files: formatted.upserts })
    projectTree.markDeleted(formatted.deletes)
  }
  await run(plugins.extensions, 'retrieve')
  await run(retrieveRenderers.extensions, 'retrieve')
  await writeProjectEntries(sourceFolder, projectTree.entries(), projectTree.deletedPaths())

  logger.log(chalk.green('Patches applied!'))
  console.timeEnd('running time')
})()
