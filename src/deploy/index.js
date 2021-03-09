const chalk = require('chalk')
const yazl = require('yazl')
const { printLogo } = require('../utils/branding-utils')
const pluginEngine = require('../plugin-engine')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const { buildXml } = require('../utils/xml-utils')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
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
  destructive = false,
  destructivePackage,
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
  const apiVersion = (await getPackageXml()).version[0]
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl,
    apiVersion
  })
  logger.log(chalk.green(`Logged in!`))
  logger.log(chalk.yellow(`(2/4) Building package.xml...`))

  const specificFilesMode = diffCfg !== undefined || files !== undefined
  const getFiles = () => (files && files.split(',').map(x => x.trim())) || []
  const getDiffFiles = () => {
    if (!diffCfg) return []
    const diff = require('child_process').spawnSync(
      'git',
      ['diff', '--name-only', '--diff-filter=d', diffCfg],
      { cwd: pathService.getBasePath() }
    )
    if (diff.status !== 0) throw Error(diff.stderr.toString('utf8'))
    return diff.stdout
      .toString('utf8')
      .split('\n')
      .filter(x => x.startsWith(pathService.getSrcFolder() + '/'))
      .map(x => x.replace(pathService.getSrcFolder() + '/', ''))
  }

  let specificFiles = [...new Set([...getDiffFiles(), ...getFiles()])]
  if (specificFiles.length) logger.log(chalk.yellow(`--files specified. Deploying only specific files...`))

  const plugins = [
    ...(stdRenderers.map(x => x.untransform)),
    ...(renderers.map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).untransform)),
    ...(destructive ? [] : preDeployPlugins)
  ]
  await pluginEngine.registerPlugins(plugins, sfdcConnector, loginOpts.username, await getPackageXml({ specificFiles, sfdcConnector }), config)

  specificFiles = pluginEngine.applyRemappers(specificFiles)

  if (specificFilesMode && !specificFiles.length) {
    logger.log(chalk.yellow('No files to deploy. Deploy skipped'))
    return { status: 'Succeeded' }
  }

  if (!(specificFilesMode || destructivePackage) && destructive) {
    throw Error('Full destructive changeset is too dangerous. You must specify --files, --diff or a value for the destructive option')
  }

  logger.log(chalk.green(`Built package.xml!`))
  logger.log(chalk.yellow(`(3/4) Creating zip & applying predeploy patches...`))

  const packageMapping = await getPackageMapping(sfdcConnector)
  const filesToRead = await getListOfSrcFiles(packageMapping, specificFilesMode ? specificFiles : ['**/*'])
  const targetFiles = readFiles(pathService.getSrcFolder(true), filesToRead)
  await pluginEngine.applyTransformations(targetFiles)

  const fileMap = _.keyBy(targetFiles, 'fileName')

  logger.time('zip creation')
  const zip = new yazl.ZipFile()
  if (destructive) {
    zip.addBuffer(Buffer.from(buildXml({ Package: { version: apiVersion } }) + '\n', 'utf-8'), 'package.xml')
    if (specificFilesMode) {
    logger.log(chalk.yellow('The following files will be deleted:'))
    const fileList = targetFiles.filter(pluginEngine.applyFilters()).map(x => x.fileName)
    logger.log(chalk.grey(fileList.join('\n')))
    const pkgJson = await getPackageXml({ specificFiles: fileList, sfdcConnector, skipParseGlobPatterns: true })
    zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'destructiveChanges.xml')
    } else if (destructivePackage && typeof destructivePackage === 'string') {
      logger.log(chalk.yellow(`Metadata specified in ${destructivePackage} will be deleted`))
      const pkgJson = await getPackageXml({ specificPackage: destructivePackage, sfdcConnector, skipParseGlobPatterns: true })
      zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'destructiveChanges.xml')
    }
  } else {
    const fileList = []
    targetFiles
      .filter(pluginEngine.applyFilters())
      .map(x => x.fileName)
      .forEach(f => {
        if (specificFiles.length) fileList.push(f)
        zip.addBuffer(fileMap[f].data, f)
      })
    const pkgJson = await getPackageXml({ specificFiles: fileList, sfdcConnector, skipParseGlobPatterns: true })
    zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'package.xml')
    if (fileList.length) {
      logger.log(chalk.yellow('The following files will be deployed:'))
      logger.log(chalk.grey(fileList.join('\n')))
    }
  }

  zip.end()
  logger.timeEnd('zip creation')
  logger.log(chalk.green(`Zip created`))
  logger.log(chalk.yellow('(4/4) Uploading...'))
  const testOptions = {}
  if (specifiedTests) testOptions.runTests = specifiedTests.split(',').map(x => x.trim())
  if (testLevel) testOptions.testLevel = testLevel
  const deployJob = await sfdcConnector.deployMetadata(zip.outputStream, Object.assign(testOptions, {
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
