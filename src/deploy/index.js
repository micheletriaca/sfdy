const chalk = require('chalk')
const AdmZip = require('adm-zip')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const Sfdc = require('../utils/sfdc-utils')
const { buildXml } = require('../utils/xml-utils')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const pathService = require('../services/path-service')
const printDeployResult = require('../deploy/result-logger')
const logService = require('../services/log-service')
const log = logService.getLogger()
const { readFiles, readAllFilesInFolder } = require('../services/file-service')

module.exports = async ({ loginOpts, checkOnly = false, basePath, logger, diffCfg, files, preDeployPlugins, specifiedTests, testLevel, testReport, srcFolder, config }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (srcFolder) pathService.setSrcFolder(srcFolder)
  if (logger) logService.setLogger(logger)
  console.time('running time')
  printLogo()
  log(chalk.yellow(`(1/4) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion: (await getPackageXml()).version[0]
  })
  log(chalk.green(`Logged in!`))
  log(chalk.yellow(`(2/4) Building package.xml...`))
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
  if (specificFiles.length) log(chalk.yellow(`--files specified. Deploying only specific files...`))
  const pkgJson = await getPackageXml({ specificFiles, sfdcConnector })
  log(chalk.green(`Built package.xml!`))
  log(chalk.yellow(`(3/4) Creating zip & applying predeploy patches...`))
  const zip = new AdmZip()

  const targetFiles = specificFiles.length
    ? readFiles(pathService.getSrcFolder())
    : readAllFilesInFolder(pathService.getSrcFolder())

  await pluginEngine.registerPlugins(preDeployPlugins, sfdcConnector, loginOpts.username, pkgJson, config)
  await pluginEngine.applyTransformations(targetFiles, sfdcConnector)

  zip.addFile('package.xml', Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'))
  const fileMap = _.keyBy(targetFiles, 'fileName')
  if (specificFiles.length) {
    const fileList = []
    const packageMapping = await getPackageMapping(sfdcConnector)
    ;(await getListOfSrcFiles(packageMapping, specificFiles))
      .filter(pluginEngine.applyFilters())
      .forEach(f => { fileList.push(f); zip.addFile(f, fileMap[f].data) })
    log(chalk.yellow('The following files will be deployed:'))
    log(chalk.grey(fileList.join('\n')))
  } else {
    ;(await getListOfSrcFiles())
      .filter(pluginEngine.applyFilters())
      .forEach(f => zip.addFile(f, fileMap[f].data))
  }
  const base64 = zip.toBuffer().toString('base64')
  log(chalk.green(`Zip created`))
  log(chalk.yellow('(4/4) Uploading...'))
  const testOptions = {}
  if (specifiedTests) testOptions.runTests = specifiedTests.split(',').map(x => x.trim())
  if (testLevel) testOptions.testLevel = testLevel
  const deployJob = await sfdcConnector.deployMetadata(base64, Object.assign(testOptions, {
    checkOnly,
    singlePackage: true,
    rollbackOnError: true
  }))
  log(chalk.yellow(`Data uploaded. Polling...`))
  const typeOfDeploy = checkOnly ? 'Validate' : 'Deploy'
  const deployResult = await sfdcConnector.pollDeployMetadataStatus(deployJob.id, testReport, r => {
    const numProcessed = parseInt(r.numberComponentsDeployed, 10) + parseInt(r.numberComponentErrors, 10)
    if (numProcessed + '' === r.numberComponentsTotal && r.runTestsEnabled === 'true' && r.numberTestsTotal !== '0') {
      const errors = r.numberTestErrors > 0 ? chalk.red(r.numberTestErrors) : chalk.green(r.numberTestErrors)
      const numProcessed = parseInt(r.numberTestsCompleted, 10) + parseInt(r.numberTestErrors, 10)
      log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
    } else if (r.numberComponentsTotal !== '0') {
      const errors = r.numberComponentErrors > 0 ? chalk.red(r.numberComponentErrors) : chalk.green(r.numberComponentErrors)
      log(chalk.grey(`${typeOfDeploy}: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
    } else {
      log(chalk.grey(`${typeOfDeploy}: starting...`))
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
