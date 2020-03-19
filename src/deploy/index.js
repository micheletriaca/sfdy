const chalk = require('chalk')
const yazl = require('yazl')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const Sfdc = require('../utils/sfdc-utils')
const { buildXml } = require('../utils/xml-utils')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
const __ = require('highland')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const pathService = require('../services/path-service')
const printDeployResult = require('../deploy/result-logger')
const logger = require('../services/log-service')
const { readFiles } = require('../services/file-service')
const path = require('path')
const nativeRequire = require('../utils/native-require')

module.exports = async ({
  loginOpts,
  checkOnly = false,
  basePath,
  logger: _logger,
  diffCfg,
  files,
  preDeployPlugins = [],
  renderers = [],
  specifiedTests,
  testLevel,
  testReport,
  srcFolder,
  config
}) => {
  if (basePath) pathService.setBasePath(basePath)
  if (srcFolder) pathService.setSrcFolder(srcFolder)
  if (_logger) logger.setLogger(_logger)
  console.time('running time')
  printLogo()
  logger.log(chalk.yellow(`(1/4) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion: (await getPackageXml()).version[0]
  })
  logger.log(chalk.green(`Logged in!`))
  logger.log(chalk.yellow(`(2/4) Building package.xml...`))
  const specificFiles = []
  if (diffCfg) {
    const { spawnSync } = require('child_process')
    const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=d', diffCfg], {
      cwd: pathService.getBasePath()
    })
    if (diff.status !== 0) throw Error(diff.stderr.toString('utf8'))
    diff.stdout
      .toString('utf8')
      .split('\n')
      .filter(x => x.startsWith(pathService.getSrcFolder() + '/'))
      .map(x => x.replace(pathService.getSrcFolder() + '/', ''))
      .forEach(x => specificFiles.push(x))
  }
  if (files) files.split(',').map(x => x.trim()).forEach(x => specificFiles.push(x))
  if (specificFiles.length) logger.log(chalk.yellow(`--files specified. Deploying only specific files...`))
  const pkgJson = await getPackageXml({ specificFiles, sfdcConnector })
  logger.log(chalk.green(`Built package.xml!`))
  logger.log(chalk.yellow(`(3/4) Creating zip & applying predeploy patches...`))

  const packageMapping = await getPackageMapping(sfdcConnector)
  const filesToRead = await getListOfSrcFiles(packageMapping, specificFiles.length ? specificFiles : ['**/*'])
  const targetFiles = readFiles(pathService.getSrcFolder(true), filesToRead)
  const fileMap = _.keyBy(targetFiles, 'fileName')

  const plugins = [
    ...(renderers.map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).untransform)),
    ...preDeployPlugins
  ]
  await pluginEngine.registerPlugins(plugins, sfdcConnector, loginOpts.username, pkgJson, config)
  await pluginEngine.applyTransformations(targetFiles, sfdcConnector)

  logger.time('zip creation')
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'package.xml')
  const fileList = []
  filesToRead
    .filter(pluginEngine.applyFilters())
    .forEach(f => {
      if (specificFiles.length) fileList.push(f)
      zip.addBuffer(fileMap[f].data, f)
    })

  if (fileList.length) {
    logger.log(chalk.yellow('The following files will be deployed:'))
    logger.log(chalk.grey(fileList.join('\n')))
  }

  zip.end()
  const base64 = await __(zip.outputStream)
    .reduce([], (accumulator, data) => { accumulator.push(data); return accumulator })
    .map(chunks => Buffer.concat(chunks).toString('base64'))
    .toPromise(Promise)

  logger.timeEnd('zip creation')
  logger.log(chalk.green(`Zip created`))
  logger.log(chalk.yellow('(4/4) Uploading...'))
  const testOptions = {}
  if (specifiedTests) testOptions.runTests = specifiedTests.split(',').map(x => x.trim())
  if (testLevel) testOptions.testLevel = testLevel
  const deployJob = await sfdcConnector.deployMetadata(base64, Object.assign(testOptions, {
    checkOnly,
    singlePackage: true,
    rollbackOnError: true
  }))
  logger.log(chalk.yellow(`Data uploaded. Polling...`))
  const typeOfDeploy = checkOnly ? 'Validate' : 'Deploy'
  const deployResult = await sfdcConnector.pollDeployMetadataStatus(deployJob.id, testReport, r => {
    const numProcessed = parseInt(r.numberComponentsDeployed, 10) + parseInt(r.numberComponentErrors, 10)
    if (numProcessed + '' === r.numberComponentsTotal && r.runTestsEnabled === 'true' && r.numberTestsTotal !== '0') {
      const errors = r.numberTestErrors > 0 ? chalk.red(r.numberTestErrors) : chalk.green(r.numberTestErrors)
      const numProcessed = parseInt(r.numberTestsCompleted, 10) + parseInt(r.numberTestErrors, 10)
      logger.log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
    } else if (r.numberComponentsTotal !== '0') {
      const errors = r.numberComponentErrors > 0 ? chalk.red(r.numberComponentErrors) : chalk.green(r.numberComponentErrors)
      logger.log(chalk.grey(`${typeOfDeploy}: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
    } else {
      logger.log(chalk.grey(`${typeOfDeploy}: starting...`))
    }
  })

  const d = deployResult.details
  if (testReport && d.runTestResult) {
    await buildJunitTestReport(d.runTestResult)
  }

  printDeployResult(deployResult)
  console.timeEnd('running time')

  return deployResult
}
