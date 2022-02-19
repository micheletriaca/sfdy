const _ = require('exstream.js')
const { printLogo } = require('../utils/branding-utils')
const chalk = require('chalk')
const Sfdc = require('../utils/sfdc-utils')
const pathService = require('../services/path-service')
const multimatch = require('multimatch')
const stdRenderers = require('../renderers')
const yazl = require('yazl')
const nativeRequire = require('../utils/native-require')
const globby = require('globby')
const path = require('path')
const { readFiles } = require('../services/file-service')
const { getPackageMapping, buildPackageXmlFromFiles, getCompanionsFileList } = require('../utils/package-utils')
const { buildXml } = require('../utils/xml-utils')
const printDeployResult = require('./result-logger')
const buildJunitTestReport = require('../deploy/junit-test-report-builder')
const pluginEngine = require('../plugin-engine')

_.extend('log', function (msg, severity = 'gray') {
  return this.tap(() => console.log(chalk[severity](msg)))
})

const injectSfdc = creds => _.pipeline()
  .map(async ctx => {
    ctx.sfdc = await Sfdc.newInstance({
      username: creds.username,
      password: creds.password,
      isSandbox: !!creds.sandbox,
      serverUrl: creds.serverUrl,
      apiVersion: '54.0'
    })
    ctx.creds = creds
    ctx.packageMapping = await getPackageMapping(ctx.sfdc)
    return ctx
  })
  .resolve()

const parseGlobPatterns = (patternString = '', storeIn) => _.pipeline()
  .map(ctx => {
    let hasPar = false
    const res = []
    let item = ''
    for (let i = 0, len = patternString.length; i < len; i++) {
      if (patternString[i] === '{') hasPar = true
      if (patternString[i] === '}') hasPar = false
      if (patternString[i] !== ',' || hasPar) item += patternString[i]
      else if (!hasPar) {
        res.push(item)
        item = ''
      }
    }
    if (item) res.push(item)
    ctx[storeIn] = res.map(x => x.trim())
    return ctx
  })

const calculateGitDiffList = diffCfg => _.pipeline()
  .map(ctx => {
    if (!diffCfg) return ctx
    const diff = require('child_process').spawnSync(
      'git',
      ['diff', '--name-only', '--diff-filter=d', diffCfg],
      { cwd: pathService.getBasePath() }
    )
    if (diff.status !== 0) throw Error(diff.stderr.toString('utf8'))
    ctx.gitDiffFileList = multimatch(diff.stdout
      .toString('utf8')
      .split('\n')
      .filter(x => x.startsWith(pathService.getSrcFolder() + '/'))
      .map(x => x.replace(pathService.getSrcFolder() + '/', '')),
    ctx.diffMaskGlobPatterns || ['*']
    )

    return ctx
  })

const calculateFileList = () => _.pipeline()
  .map(async ctx => {
    if (!ctx.filesGlobPatterns.length) return ctx
    ctx.fileList = await globby(ctx.filesGlobPatterns, { cwd: pathService.getSrcFolder(true) })
    return ctx
  })
  .resolve()

const buildFinalFileList = () => _.pipeline()
  .map(ctx => {
    ctx.finalFileList = [...new Set([...ctx.fileList, ...ctx.gitDiffFileList])].sort()
    return ctx
  })

const loadFilesInMemory = () => _.pipeline()
  .map(ctx => {
    ctx.inMemoryFiles = readFiles(pathService.getSrcFolder(true), ctx.finalFileList)
    return ctx
  })

const addCompanionsToFileList = () => _.pipeline()
  .map(async ctx => {
    const companionData = await getCompanionsFileList(ctx.finalFileList, ctx.packageMapping)
    ctx.companionsGlobPattern = companionData.globPatterns
    ctx.finalFileList = [...new Set([...ctx.finalFileList, ...companionData.companionFileList])].sort()
    return ctx
  })
  .resolve()

const buildPackageXml = () => _.pipeline()
  .map(ctx => {
    ctx.packageJson = buildPackageXmlFromFiles(ctx.finalFileList, ctx.packageMapping, ctx.sfdc.apiVersion)
    ctx.inMemoryFiles.push({
      fileName: 'package.xml',
      data: Buffer.from(buildXml(ctx.packageJson) + '\n', 'utf8')
    })
    return ctx
  })

const zipper = () => _.pipeline()
  .map(ctx => {
    const zip = new yazl.ZipFile()
    const fileList = new Set(ctx.finalFileList)
    for (const f of ctx.inMemoryFiles.filter(x => x.fileName === 'package.xml' || fileList.has(x.fileName))) {
      zip.addBuffer(f.data, f.fileName)
    }
    zip.end()
    ctx.zip = zip
    return ctx
  })

const deploy = (specifiedTests, testLevel, checkOnly) => _.pipeline()
  .map(async ctx => {
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
  .resolve()

const poll = (checkOnly, testReport) => _.pipeline()
  .map(async ctx => {
    const typeOfDeploy = checkOnly ? 'Validate' : 'Deploy'
    ctx.deployResult = await ctx.sfdc.pollDeployMetadataStatus(ctx.deployJob.id, testReport, r => {
      const numProcessed = parseInt(r.numberComponentsDeployed, 10) + parseInt(r.numberComponentErrors, 10)
      if (numProcessed + '' === r.numberComponentsTotal && r.runTestsEnabled === 'true' && r.numberTestsTotal !== '0') {
        const errors = r.numberTestErrors > 0 ? chalk.red(r.numberTestErrors) : chalk.green(r.numberTestErrors)
        const numProcessed = parseInt(r.numberTestsCompleted, 10) + parseInt(r.numberTestErrors, 10)
        console.log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
      } else if (r.numberComponentsTotal !== '0') {
        const errors = r.numberComponentErrors > 0 ? chalk.red(r.numberComponentErrors) : chalk.green(r.numberComponentErrors)
        console.log(chalk.grey(`${typeOfDeploy}: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
      } else {
        console.log(chalk.grey(`${typeOfDeploy}: starting...`))
      }
    })
    return ctx
  })
  .resolve()

const printResults = () => _.pipeline()
  .tap(ctx => printDeployResult(ctx.deployResult))
  .map(ctx => ctx.deployResult)

const generateJUnitTestResults = (testReport) => _.pipeline()
  .map(async ctx => {
    const d = ctx.deployResult.details
    if (testReport && d.runTestResult) {
      await buildJunitTestReport(d.runTestResult)
    }
    return ctx
  })
  .resolve()

module.exports = async opts => {
  const {
    loginOpts: creds, files, diffCfg, diffMask, specifiedTests,
    testLevel, checkOnly, testReport, preDeployPlugins, config, renderers
  } = opts

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
    .through(parseGlobPatterns(files, 'filesGlobPatterns'))
    .through(parseGlobPatterns(diffMask, 'diffMaskGlobPatterns'))
    .through(calculateGitDiffList(diffCfg))
    .through(calculateFileList())
    .through(buildFinalFileList())
    .log('Done!', 'green')

  const forks = [
    s1.fork()
      .filter(ctx => ctx.finalFileList.length === 0)
      .log('No files to deploy. Deploy skipped', 'yellow')
      .map(() => ({ status: 'Succeeded' })),

    s1.fork()
      .filter(ctx => ctx.finalFileList.length > 0)
      .log(`(2/5) Logging in salesforce as ${creds.username}...`, 'yellow')
      .through(injectSfdc(creds))
      .log('Logged in!', 'green')
      // .through(normalizeFiles)
      .through(addCompanionsToFileList())
      .through(loadFilesInMemory())
      .map(async ctx => {
        const stdR = stdRenderers.map(x => x.untransform)
        const customR = renderers.map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).untransform)

        await pluginEngine.executePlugins([...stdR, ...customR], ctx, config)
        await pluginEngine.executePlugins(preDeployPlugins, ctx, config)

        for (const f of ctx.inMemoryFiles) {
          if (f.transformed) f.data = buildXml(f.transformed) + '\n'
        }
        return ctx
      })
      .resolve()
      // .tap(ctx => console.log(ctx.inMemoryFiles))
      .log('(3/5) Building package.xml...', 'yellow')
      .through(buildPackageXml())
      .log('Built!', 'green')
      .log('The following files will be deployed:', 'blue')
      .tap(ctx => console.log(chalk.grey(ctx.finalFileList.join('\n') || 'No file found')))
      .log('(4/5) Creating zip...', 'yellow')
      .through(zipper())
      .log('Created!', 'green')
      .log('(5/5) Deploying...', 'yellow')
      .through(deploy(specifiedTests, testLevel, checkOnly))
      .log('Data uploaded!', 'green')
      .through(poll(checkOnly, testReport))
      .through(generateJUnitTestResults())
      .through(printResults())
  ]

  return _(forks).merge().value()

  // TODO -> GESTIRE METADATI WAVE
  // TODO -> RENDERER
  // TODO -> PREDEPLOY PLUGINS
  // TODO -> DESTRUCTIVE
}
