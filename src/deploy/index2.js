const { getPackageMapping, buildPackageXmlFromFiles, getCompanionsFileList } = require('../utils/package-utils')
const { readFiles, parseGlobPatterns } = require('../services/file-service')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const { printLogo } = require('../utils/branding-utils')
const nativeRequire = require('../utils/native-require')
const pathService = require('../services/path-service')
const printDeployResult = require('./result-logger')
const { buildXml } = require('../utils/xml-utils')
const pluginEngine = require('../plugin-engine')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const multimatch = require('multimatch')
const _ = require('exstream.js')
const globby = require('globby')
const chalk = require('chalk')
const yazl = require('yazl')
const path = require('path')
const fs = require('fs')
const p = _.pipeline

_.extend('log', function (msg, severity = 'gray') { return this.tap(() => console.log(chalk[severity](msg))) })
_.extend('asyncMap', function (fn) { return this.map(fn).resolve() })

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
  if (!diffCfg) return ctx
  const diff = require('child_process').spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=d', diffCfg],
    { cwd: pathService.getBasePath() }
  )
  if (diff.status !== 0) throw Error(diff.stderr.toString('utf8'))
  const diffOutput = diff.stdout
    .toString('utf8')
    .split('\n')
    .filter(x => x.startsWith(pathService.getSrcFolder() + '/'))
    .map(x => x.replace(pathService.getSrcFolder() + '/', ''))
  ctx.gitDiffFileList = multimatch(diffOutput, ctx.diffMaskGlobPatterns || ['**/*'])
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
  ctx.inMemoryFiles = readFiles(pathService.getSrcFolder(true), ctx.finalFileList)
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
  const customR = renderers.map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).untransform)
  await pluginEngine.executePlugins([...stdR, ...customR], ctx, config)
  if (!destructive) await pluginEngine.executePlugins(preDeployPlugins, ctx, config)
  for (const f of ctx.inMemoryFiles.filter(x => !!x.transformed)) f.data = buildXml(f.transformed) + '\n'
  return ctx
})

const buildPackageXml = () => p().map(ctx => {
  ctx.packageJson = buildPackageXmlFromFiles(ctx.finalFileList, ctx.packageMapping, ctx.sfdc.apiVersion)
  ctx.inMemoryFiles.push({
    fileName: 'package.xml',
    data: Buffer.from(buildXml(ctx.packageJson) + '\n', 'utf8')
  })
  return ctx
})

const zipper = (destructive) => p().map(ctx => {
  const zip = new yazl.ZipFile()
  const fileList = new Set(ctx.finalFileList)
  for (const f of ctx.inMemoryFiles) {
    const shouldBeAdded = (fileList.has(f.fileName) && !destructive) || f.fileName === 'package.xml'
    if (shouldBeAdded) {
      const fileName = f.fileName === 'package.xml' && destructive ? 'destructiveChanges.xml' : f.fileName
      zip.addBuffer(buildXml({ Package: { version: ctx.sfdc.apiVersion } }) + '\n', 'package.xml')
      zip.addBuffer(f.data, fileName)
    }
  }
  zip.end()
  ctx.zip = zip
  return ctx
})

const deploy = (specifiedTests, testLevel, checkOnly) => p().asyncMap(async ctx => {
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
  ctx.deployResult = await ctx.sfdc.pollDeployMetadataStatus(ctx.deployJob.id, testReport, r => {
    const numProcessed = r.numberComponentsDeployed + r.numberComponentErrors
    if (numProcessed === r.numberComponentsTotal && r.runTestsEnabled && r.numberTestsTotal) {
      const errors = chalk[r.numberTestErrors > 0 ? 'red' : 'green'](r.numberTestErrors)
      const numProcessed = r.numberTestsCompleted + r.numberTestErrors
      console.log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
    } else if (r.numberComponentsTotal) {
      const errors = chalk[r.numberComponentErrors > 0 ? 'red' : 'green'](r.numberComponentErrors)
      console.log(chalk.grey(`${typeOfDeploy}: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
    } else {
      console.log(chalk.grey(`${typeOfDeploy}: starting...`))
    }
  })
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

module.exports = async opts => {
  const {
    loginOpts: creds, files, diffCfg, diffMask, specifiedTests, destructive,
    testLevel, checkOnly, testReport, preDeployPlugins, config, renderers, excludeFiles
  } = opts

  const allExcludedFiles = [...(excludeFiles || []), ...(config.excludeFiles || [])]

  const s1 = _([{
    sfdc: null,
    packageMapping: {},
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
      .tap(ctx => console.log(chalk.grey(ctx.finalFileList.join('\n'))))
      .log('(4/5) Creating zip...', 'yellow')
      .through(zipper(destructive))
      .log('Created!', 'green')
      .log('(5/5) Deploying...', 'yellow')
      .through(deploy(specifiedTests, testLevel, checkOnly))
      .log('Data uploaded!', 'green')
      .through(poll(checkOnly, testReport))
      .through(generateJUnitTestResults())
      .through(printResults())
  ]

  return _(forks).merge().value()

  // TODO -> srcfolder, basepath & logger
  // TODO -> apiversion configurabile
}
