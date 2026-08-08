#!/usr/bin/env node

const program = require('commander')
const logger = require('./services/log-service')
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const Sfdc = require('./utils/sfdc-utils')
const pluginEngine = require('./plugin-engine')
const configService = require('./services/config-service')
const { readAllFilesInFolder } = require('./services/file-service')
const { getSrcFolder } = require('./services/path-service')
const { getPackageXml } = require('./utils/package-utils')
const pathService = require('./services/path-service')
const standardPlugins = require('./plugins')
const path = require('path')
const fs = require('fs')
const util = require('util')
const wf = util.promisify(fs.writeFile)
const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { addAuthenticationOptions, configureAuthentication, getOauth2Options } = require('./utils/auth-utils')

require('./error-handling')()

addAuthenticationOptions(program)
  .option('--skip-untransform', 'Skip untransform phase')
  .parse(process.argv)

configureAuthentication(program)

const config = configService.getConfig()

;(async () => {
  console.time('running time')
  printLogo()

  logger.log(chalk.yellow('(1/2) Logging in salesforce...'))
  const packageXml = await getPackageXml()
  const sfdcConnector = await Sfdc.newInstance({
    username: program.username,
    password: program.password,
    oauth2: getOauth2Options(program, DEFAULT_CLIENT_ID),
    serverUrl: program.serverUrl,
    isSandbox: !!program.sandbox,
    apiVersion: packageXml.version[0]
  })
  logger.log(chalk.green('Logged in!'))
  logger.log(chalk.yellow('(2/2) Applying patches...'))

  const basePath = getSrcFolder(true)
  const allFiles = readAllFilesInFolder(basePath)
  const renderers = config.renderers || []
  const plugins = [
    ...(!program.skipUntransform ? renderers.map(x => require(path.resolve(pathService.getBasePath(), x)).untransform) : []),
    ...standardPlugins,
    ...(config.postRetrievePlugins || []),
    ...renderers.map(x => require(path.resolve(pathService.getBasePath(), x)).transform)
  ]
  await pluginEngine.registerPlugins(plugins, sfdcConnector, sfdcConnector.username, packageXml, config)
  await pluginEngine.applyTransformations(allFiles)
  await Promise.all(allFiles.filter(y => y.transformedJson).map(async y => {
    await wf(path.join(basePath, y.fileName), y.data)
  }))

  logger.log(chalk.green('Patches applied!'))
  console.timeEnd('running time')
})()
