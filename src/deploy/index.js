const { getPackageMapping, buildPackageXmlFromFiles, getCompanionsFileList } = require('../utils/package-utils')
const { readFiles, parseGlobPatterns, getDiffList } = require('../services/file-service')
const { printDeployResult, pollCallback } = require('./result-logger')
const buildJunitTestReport = require('./junit-test-report-builder')
const { printLogo } = require('../utils/branding-utils')
const nativeRequire = require('../utils/native-require')
const pathService = require('../services/path-service')
const logService = require('../services/log-service')
const { buildXml } = require('../utils/xml-utils')
const pluginEngine = require('../plugin-engine')
const { zip } = require('../utils/zip-utils')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const multimatch = require('multimatch')
const _ = require('../utils/exstream')
const globby = require('globby')
const chalk = require('chalk')
const fs = require('fs')
const p = _.pipeline

const injectSfdc = creds => p().asyncMap(async ctx => {
  ctx.sfdc = await Sfdc.newInstance(creds)
  ctx.packageMapping = await getPackageMapping(ctx.sfdc)
  ctx.creds = creds
  return ctx
})

const injectGlobPatterns = (patternString = '', storeIn) => p().map(ctx => {
  ctx[storeIn] = parseGlobPatterns(patternString)
  return ctx
})

const calculateGitDiffList = diffCfg => p().map(ctx => {
  ctx.gitDiffFileList = getDiffList(diffCfg, ctx.diffMaskGlobPatterns)
  return ctx
})

const calculateManualFileList = () => p().asyncMap(async ctx => {
  if (!ctx.filesGlobPatterns.length) return ctx
  ctx.fileList = await globby(ctx.filesGlobPatterns, { cwd: pathService.getSrcFolder(true) })
  return ctx
})

const mergeFileListsAndBuildTheFinalOne = excludeFiles => p().map(ctx => {
  const STD_EXCLUSIONS = ['!package.xml', '!lwc/.eslintrc.json', '!lwc/jsconfig.json']
  const ignorePattern = ['**/*', ...STD_EXCLUSIONS, ...excludeFiles.map(x => '!' + x)]
  const fileList = [...new Set([...ctx.fileList, ...ctx.gitDiffFileList])]
  ctx.finalFileList = multimatch(fileList, ignorePattern).sort()
  if (fileList.length !== ctx.finalFileList.length) {
    console.log(chalk.yellow('WARN: some files have been excluded from deploy because ' +
      `they match one of these patterns: \n${ignorePattern.slice(1).join('\n')}`))
  }
  return ctx
})

const loadFilesInMemory = () => p().map(ctx => {
  ctx.inMemoryFiles = readFiles(ctx.finalFileList)
  return ctx
})

const addCompanionsToFinalFileList = () => p().asyncMap(async ctx => {
  const companionData = await getCompanionsFileList(ctx.finalFileList, ctx.packageMapping)
  ctx.companionsGlobPattern = companionData.globPatterns
  ctx.finalFileList = [...new Set([...ctx.finalFileList, ...companionData.companionFileList])].sort()
  return ctx
})

const applyPlugins = (preDeployPlugins, config, renderers, destructive) => p().asyncMap(async ctx => {
  const stdR = stdRenderers.map(x => x.untransform)
  const customR = renderers.map(x => nativeRequire(x).untransform)
  await pluginEngine.executePlugins([...stdR, ...customR], ctx, config)
  if (!destructive) await pluginEngine.executePlugins(preDeployPlugins, ctx, config)
  for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = buildXml(f.transformed) + '\n'
  return ctx
})

const buildPackageXml = () => p().map(ctx => {
  ctx.packageJson = buildPackageXmlFromFiles(ctx.finalFileList, ctx.packageMapping, ctx.sfdc.apiVersion)
  return ctx
})

const zipper = destructive => p().map(ctx => {
  ctx.zip = zip(ctx.finalFileList, ctx.inMemoryFiles, ctx.packageJson, destructive)
  return ctx
})

const startDeploy = (specifiedTests, testLevel, checkOnly) => p().asyncMap(async ctx => {
  const testOptions = {}
  if (specifiedTests) testOptions.runTests = specifiedTests.split(',').map(x => x.trim())
  if (testLevel) testOptions.testLevel = testLevel
  ctx.deployJob = await ctx.sfdc.deployMetadata(ctx.zip.outputStream, {
    ...testOptions,
    checkOnly,
    singlePackage: true,
    rollbackOnError: true
  })
  return ctx
})

const poll = (checkOnly, testReport) => p().asyncMap(async ctx => {
  const typeOfDeploy = checkOnly ? 'Validate' : 'Deploy'
  ctx.deployResult = await ctx.sfdc.pollDeployMetadataStatus(ctx.deployJob.id, testReport, pollCallback(typeOfDeploy))
  return ctx
})

const printResults = () => p()
  .tap(ctx => printDeployResult(ctx.deployResult))
  .map(ctx => ctx.deployResult)

const generateJUnitTestResults = (testReport) => p().map(ctx => {
  const d = ctx.deployResult.details
  if (testReport && d.runTestResult) buildJunitTestReport(d.runTestResult)
  return ctx
})

module.exports = async function deploy (opts) {
  const {
    loginOpts: creds, files, diffCfg, diffMask, specifiedTests, destructive, basePath, srcFolder,
    testLevel, checkOnly, testReport, preDeployPlugins, config, renderers, excludeFiles, logger
  } = opts

  if (basePath) pathService.setBasePath(basePath)
  if (srcFolder) pathService.setSrcFolder(srcFolder)
  if (logger) logService.setLogger(logger)

  const allExcludedFiles = [...(excludeFiles || []), ...(config.excludeFiles || [])]

  const s1 = _([{
    sfdc: null,
    packageMapping: {},
    creds: null,
    filesGlobPatterns: [],
    diffMaskGlobPatterns: [],
    companionsGlobPattern: [],
    gitDiffFileList: [],
    fileList: [],
    finalFileList: [],
    inMemoryFiles: [],
    packageJson: null,
    zip: null,
    deployJob: null,
    deployResult: null
  }])
    .tap(printLogo)
    .log('(1/5) Getting files to deploy...', 'yellow')
    .through(injectGlobPatterns(files, 'filesGlobPatterns'))
    .through(injectGlobPatterns(diffMask, 'diffMaskGlobPatterns'))
    .through(calculateGitDiffList(diffCfg))
    .through(calculateManualFileList())
    .through(mergeFileListsAndBuildTheFinalOne(allExcludedFiles))
    .log('Done!', 'green')
    .log(`(2/5) Logging in salesforce as ${creds.username}...`, 'yellow')
    .through(injectSfdc(creds))
    .log('Logged in!', 'green')
    .through(addCompanionsToFinalFileList())
    .through(loadFilesInMemory())
    .through(applyPlugins(preDeployPlugins, config, renderers, destructive))
    .through(addCompanionsToFinalFileList()) // Must be done again, in case the plugins have added something to the list
    .tap(x => process.env.DEBUG === 'true' ? console.log(x) : null)
    .tap(x => process.env.TRACE === 'true' ? fs.writeFileSync('dump.json', JSON.stringify(x)) : null)

  const forks = [
    s1.fork()
      .filter(ctx => ctx.finalFileList.length === 0)
      .log('No files to deploy. Deploy skipped', 'yellow')
      .map(() => ({ status: 'Succeeded' })),

    s1.fork()
      .filter(ctx => ctx.finalFileList.length > 0)
      .log('(3/5) Building package.xml...', 'yellow')
      .through(buildPackageXml())
      .log('Built!', 'green')
      .log(`The following files will be ${destructive ? 'deleted' : 'deployed'}:`, destructive ? 'red' : 'blue')
      .log(ctx => ctx.finalFileList.join('\n'))
      .log('(4/5) Creating zip...', 'yellow')
      .through(zipper(destructive))
      .log('Created!', 'green')
      .log('(5/5) Deploying...', 'yellow')
      .through(startDeploy(specifiedTests, testLevel, checkOnly))
      .log('Data uploaded!', 'green')
      .through(poll(checkOnly, testReport))
      .through(generateJUnitTestResults())
      .through(printResults())
  ]

  return _(forks).merge().value()
}
