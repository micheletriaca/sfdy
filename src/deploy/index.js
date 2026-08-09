const chalk = require('chalk')
const yazl = require('yazl')
const { printLogo } = require('../utils/branding-utils')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const { buildXml } = require('../utils/xml-utils')
const { expandDirectoryPatterns, getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const pathService = require('../services/path-service')
const printDeployResult = require('../deploy/result-logger')
const logger = require('../services/log-service')
const { readFiles } = require('../services/file-service')
const { DEFAULT_CLIENT_ID } = require('../utils/constants')
const { getOauth2Options } = require('../utils/auth-utils')
const { getAdapter } = require('../format-adapters')
const globby = require('globby')
const { FileSelection, FileTree } = require('../plugin')
const { resolveSelections, runExtensions } = require('../plugin/runtime')
const { prepareExtensions, warnLegacy } = require('../plugin/loader')
const { readProjectEntries } = require('../plugin/project-files')

module.exports = async ({
  loginOpts,
  checkOnly = false,
  ignoreWarnings = false,
  destructive = false,
  destructivePackage,
  basePath,
  logger: _logger,
  diffCfg,
  files,
  preDeployPlugins = [],
  renderers = [],
  quickDeploy = false,
  specifiedTests,
  testLevel,
  testReport,
  srcFolder,
  sourceFormat,
  config = {},
  excludeFiles = []
}) => {
  pathService.configureProject({ basePath, srcFolder, sourceFormat, config })
  if (_logger) logger.setLogger(_logger)
  let formatAdapter = getAdapter(config, sourceFormat)
  console.time('running time')
  printLogo()
  logger.log(chalk.yellow('(1/4) Logging in salesforce...'))
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
  if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))

  let deployJob
  if (quickDeploy) {
    deployJob = await performQuickDeploy({
      sfdcConnector,
      deploymentId: quickDeploy
    })
  } else {
    deployJob = await performFullDeploy({
      diffCfg,
      files,
      renderers,
      destructive,
      sfdcConnector,
      preDeployPlugins,
      destructivePackage,
      config,
      excludeFiles,
      apiVersion,
      specifiedTests,
      checkOnly,
      ignoreWarnings,
      testLevel,
      formatAdapter
    })
  }
  logger.log(chalk.yellow(`Deployment Id: ${deployJob.id}`))

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

const performQuickDeploy = async ({
  sfdcConnector,
  deploymentId
}) => {
  return await sfdcConnector.quickDeployMetadata(deploymentId)
}

const performFullDeploy = async ({
  diffCfg,
  files,
  renderers,
  destructive,
  sfdcConnector,
  preDeployPlugins,
  destructivePackage,
  config,
  excludeFiles,
  apiVersion,
  specifiedTests,
  checkOnly,
  ignoreWarnings,
  testLevel,
  formatAdapter
}) => {
  logger.log(chalk.yellow('(2/4) Building package.xml...'))

  const specificFilesMode = diffCfg !== undefined || files !== undefined
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

  const specificFiles = [...new Set([...getDiffFiles(), ...getFiles(files)])]
  if (specificFiles.length) logger.log(chalk.yellow('--files specified. Deploying only specific files...'))

  const filesToExclude = new Set([...((config && config.excludeFiles) || []), ...(excludeFiles || [])])
  const sourceFolder = pathService.getSrcFolder(true)
  const diskEntries = await readProjectEntries(sourceFolder)
  const availableFiles = diskEntries.map(entry => entry.fileName)
  const packageMapping = formatAdapter ? null : await getPackageMapping(sfdcConnector)
  let selectedProjectFiles
  let initialPackage
  let sourceComponents = []

  if (formatAdapter) {
    const selectedFiles = specificFilesMode
      ? await globby(expandDirectoryPatterns(specificFiles), { cwd: sourceFolder })
      : availableFiles
    selectedProjectFiles = formatAdapter.getCompanionPaths(selectedFiles, availableFiles)
    const ignoredFiles = new Set(['package.xml', 'lwc/.eslintrc.json', 'lwc/jsconfig.json'])
    selectedProjectFiles = [...new Set(selectedProjectFiles)]
      .filter(fileName => !ignoredFiles.has(fileName))
      .filter(fileName => formatAdapter.isMetadataPath(fileName))
    sourceComponents = formatAdapter.getPackageComponents(formatAdapter.resolve(selectedProjectFiles))
    initialPackage = await getPackageXml({
      specificMeta: sourceComponents.map(x => `${x.type}/${x.fullName}`),
      sfdcConnector,
      apiVersion
    })
  } else {
    if (specificFilesMode) {
      initialPackage = await getPackageXml({ specificFiles, sfdcConnector, apiVersion })
      selectedProjectFiles = specificFiles
    } else {
      selectedProjectFiles = availableFiles
      initialPackage = await getPackageXml({
        specificFiles: selectedProjectFiles,
        sfdcConnector,
        skipParseGlobPatterns: true,
        apiVersion
      })
    }
  }

  const preparedRenderers = prepareExtensions({
    entries: [
      ...(formatAdapter ? [] : stdRenderers),
      ...renderers
    ],
    basePath: pathService.getBasePath(),
    packageJson: initialPackage,
    legacyHook: 'untransform'
  })
  const preparedPlugins = prepareExtensions({
    entries: destructive ? [] : preDeployPlugins,
    basePath: pathService.getBasePath(),
    packageJson: initialPackage
  })
  warnLegacy(preparedRenderers.legacy, 'Renderer')
  warnLegacy(preparedPlugins.legacy, 'Plugin')

  if (specificFilesMode) {
    const selection = new FileSelection(selectedProjectFiles)
    const diskTree = new FileTree({ diskEntries })
    await resolveSelections({
      extensions: [...preparedRenderers.extensions, ...preparedPlugins.extensions],
      selection,
      project: diskTree.project,
      direction: 'deploy',
      format: formatAdapter ? 'sfdx' : 'metadata',
      target: { environment: process.env.environment, username: sfdcConnector.username },
      sfdcConnector,
      config
    })
    selectedProjectFiles = selection.values()
  }

  if (formatAdapter) {
    const expandedSelection = specificFilesMode
      ? await globby(expandDirectoryPatterns(selectedProjectFiles), { cwd: sourceFolder })
      : selectedProjectFiles
    selectedProjectFiles = formatAdapter.getCompanionPaths(expandedSelection, availableFiles)
      .filter(fileName => formatAdapter.isMetadataPath(fileName))
  } else if (specificFilesMode) {
    selectedProjectFiles = await getListOfSrcFiles(packageMapping, selectedProjectFiles)
  }

  const fileTree = new FileTree({
    diskEntries,
    files: readFiles(sourceFolder, selectedProjectFiles, [...filesToExclude]),
    origin: 'disk'
  })
  const runOptions = {
    fileTree,
    direction: 'deploy',
    format: formatAdapter ? 'sfdx' : 'metadata',
    target: { environment: process.env.environment, username: sfdcConnector.username },
    sfdcConnector,
    config,
    checkOnly,
    destructive
  }
  await runExtensions({ ...runOptions, extensions: preparedRenderers.extensions })
  await runExtensions({ ...runOptions, extensions: preparedPlugins.extensions })

  let metadataTree = fileTree
  if (formatAdapter) {
    const converted = await formatAdapter.toMetadata(fileTree.entries())
    metadataTree = new FileTree({ files: converted.entries })
    sourceComponents = formatAdapter.getPackageComponents(converted.components)
  }
  await runExtensions({
    ...runOptions,
    fileTree: metadataTree,
    stage: 'metadata',
    extensions: preparedPlugins.extensions
  })
  const targetFiles = metadataTree.entries()
  if (formatAdapter) {
    const resolvedMetadata = await formatAdapter.resolveMetadata(targetFiles)
    const finalComponentKeys = new Set([...resolvedMetadata, ...formatAdapter.getPackageComponents(resolvedMetadata)]
      .map(component => `${component.type}/${component.fullName}`))
    sourceComponents = sourceComponents.filter(component =>
      finalComponentKeys.has(`${component.type}/${component.fullName}`))
  }

  if (!(specificFilesMode || destructivePackage) && destructive) {
    throw Error('Full destructive changeset is too dangerous. You must specify --files, --diff or a value for the destructive option')
  }

  logger.log(chalk.green('Built package.xml!'))
  logger.log(chalk.yellow('(3/4) Creating zip & applying predeploy patches...'))

  const fileMap = _.keyBy(targetFiles, 'fileName')

  if (!targetFiles.length) {
    logger.log(chalk.yellow('No files to deploy. Deploy skipped'))
    return { status: 'Succeeded' }
  }

  logger.time('zip creation')
  const zip = new yazl.ZipFile()
  if (destructive) {
    zip.addBuffer(Buffer.from(buildXml({ Package: { version: apiVersion } }) + '\n', 'utf-8'), 'package.xml')
    if (specificFilesMode) {
      logger.log(chalk.yellow('The following files will be deleted:'))
      const fileList = targetFiles.map(x => x.fileName)
      logger.log(chalk.grey(fileList.join('\n')))
      const pkgJson = formatAdapter
        ? await getPackageXml({ specificMeta: sourceComponents.map(x => `${x.type}/${x.fullName}`), sfdcConnector, apiVersion })
        : await getPackageXml({ specificFiles: fileList, sfdcConnector, skipParseGlobPatterns: true, apiVersion })
      zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'destructiveChanges.xml')
    } else if (destructivePackage && typeof destructivePackage === 'string') {
      logger.log(chalk.yellow(`Metadata specified in ${destructivePackage} will be deleted`))
      const pkgJson = await getPackageXml({ specificPackage: destructivePackage, sfdcConnector, skipParseGlobPatterns: true })
      zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'destructiveChanges.xml')
    }
  } else {
    const fileList = []
    targetFiles
      .map(x => x.fileName)
      .forEach(f => {
        fileList.push(f)
        zip.addBuffer(fileMap[f].data, f)
      })
    const pkgJson = formatAdapter
      ? await getPackageXml({
        specificMeta: sourceComponents.map(component => `${component.type}/${component.fullName}`),
        sfdcConnector,
        apiVersion
      })
      : await getPackageXml({
        specificFiles: fileList,
        sfdcConnector,
        skipParseGlobPatterns: true,
        apiVersion
      })
    zip.addBuffer(Buffer.from(buildXml({ Package: pkgJson }) + '\n', 'utf-8'), 'package.xml')
    if (specificFilesMode && fileList.length) {
      logger.log(chalk.yellow('The following files will be deployed:'))
      logger.log(chalk.grey(fileList.join('\n')))
    }
  }

  zip.end()
  logger.timeEnd('zip creation')
  logger.log(chalk.green('Zip created'))
  logger.log(chalk.yellow('(4/4) Uploading...'))
  const testOptions = {}
  if (specifiedTests) testOptions.runTests = specifiedTests.split(',').map(x => x.trim())
  if (testLevel) testOptions.testLevel = testLevel
  const deployJob = await sfdcConnector.deployMetadata(zip.outputStream, Object.assign(testOptions, {
    checkOnly,
    ignoreWarnings,
    singlePackage: true,
    rollbackOnError: true
  }))
  logger.log(chalk.yellow('Data uploaded. Polling...'))
  return deployJob
}
