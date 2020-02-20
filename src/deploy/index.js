const chalk = require('chalk')
const AdmZip = require('adm-zip')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const Sfdc = require('../utils/sfdc-utils')
const { buildXml } = require('../utils/xml-utils')
const path = require('path')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const pathService = require('../services/path-service')
const printDeployResult = require('../deploy/result-logger')
const logService = require('../services/log-service')
const log = logService.getLogger()

module.exports = async ({ loginOpts, checkOnly, basePath, logger, diffCfg, files, preDeployPlugins, specifiedTests, testLevel, testReport }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (logger) logService.setLogger(logger)
  console.time('running time')
  printLogo()
  log(chalk.yellow(`(1/4) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl
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
      .filter(x => x.startsWith('src/'))
      .map(x => x.replace('src/', ''))
      .forEach(x => specificFiles.push(x))
  }
  if (files) files.split(',').map(x => x.trim()).forEach(x => specificFiles.push(x))
  if (specificFiles.length) log(chalk.yellow(`--files specified. Deploying only specific files...`))
  const pkgJson = await getPackageXml({ specificFiles, sfdcConnector })
  log(chalk.green(`Built package.xml!`))
  log(chalk.yellow(`(3/4) Creating zip...`))
  const zip = new AdmZip()

  await pluginEngine.registerPlugins(preDeployPlugins, sfdcConnector, loginOpts.username, pkgJson)
  const transformedXml = _(await pluginEngine.applyTransformations(specificFiles, sfdcConnector))
    .keyBy('filename')
    .value()

  zip.addFile('package.xml', Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'))
  if (specificFiles.length) {
    const packageMapping = await getPackageMapping(sfdcConnector)
    ;(await getListOfSrcFiles(packageMapping, specificFiles)).map(f => {
      if (transformedXml[f]) zip.addFile(f, Buffer.from(transformedXml[f].transformedXml, 'utf-8'))
      else zip.addLocalFile(path.resolve(pathService.getBasePath(), 'src', f), f.substring(0, f.lastIndexOf('/')))
    })
  } else {
    ;(await getListOfSrcFiles()).map(f => {
      if (transformedXml[f]) zip.addFile(f, Buffer.from(transformedXml[f].transformedXml, 'utf-8'))
      else zip.addLocalFile(path.resolve(pathService.getBasePath(), 'src', f), f.substring(0, f.lastIndexOf('/')))
    })
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
  const deployResult = await sfdcConnector.pollDeployMetadataStatus(deployJob.id, testReport, r => {
    const numProcessed = parseInt(r.numberComponentsDeployed, 10) + parseInt(r.numberComponentErrors, 10)
    if (numProcessed + '' === r.numberComponentsTotal && r.runTestsEnabled === 'true' && r.numberTestsTotal !== '0') {
      const errors = r.numberTestErrors > 0 ? chalk.red(r.numberTestErrors) : chalk.green(r.numberTestErrors)
      const numProcessed = parseInt(r.numberTestsCompleted, 10) + parseInt(r.numberTestErrors, 10)
      log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
    } else if (r.numberComponentsTotal !== '0') {
      const errors = r.numberComponentErrors > 0 ? chalk.red(r.numberComponentErrors) : chalk.green(r.numberComponentErrors)
      log(chalk.grey(`Deploy: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
    } else {
      log(chalk.grey(`Deploy: starting...`))
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
