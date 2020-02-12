#!/usr/bin/env node

const program = require('commander')
const chalk = require('chalk')
const log = console.log
const fs = require('fs-extra')
const path = require('path')
const keyBy = require('lodash.keyby')
const _ = require('highland')
const AdmZip = require('adm-zip')
const Sfdc = require('./utils/sfdc-utils')
const os = require('os')
const { buildXml } = require('./utils/xml-utils')
const { getListOfSrcFiles, getPackageXml } = require('./utils/package-utils')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('-f, --files <files>', 'Deploy specific files')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

;(async () => {
  console.time('running time')
  log(chalk.green('SFTX V1.0'))
  log(chalk.yellow(`(1/4) Logging in salesforce as ${program.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: program.username,
    password: program.password,
    isSandbox: !!program.sandbox
  })
  log(chalk.green(`Logged in!`))
  log(chalk.yellow(`(2/4) Building package.xml...`))
  const specificFiles = (program.files && program.files.split(',').map(x => x.trim())) || []
  if (specificFiles.length) log(chalk.yellow(`--files specified. Deploying only specific files...`))
  const pkgJson = await getPackageXml({ specificFiles, sfdcConnector })
  log(chalk.green(`Built package.xml!`))
  log(chalk.yellow(`(3/4) Creating zip...`))
  const zip = new AdmZip()
  if (specificFiles.length) {
    zip.addFile('package.xml', Buffer.from(buildXml(pkgJson) + '\n', 'utf-8'))
    const cachePath = path.resolve(os.tmpdir(), 'sftx' + sfdcConnector.sfConn.sessionId)
    const hasCache = fs.existsSync(cachePath)
    const packageMapping = hasCache ? JSON.parse(fs.readFileSync(cachePath)) : (await sfdcConnector.describeMetadata()).metadataObjects
    fs.writeFileSync(cachePath, JSON.stringify(packageMapping))
    ;(await getListOfSrcFiles(keyBy(packageMapping, 'directoryName'), specificFiles)).map(f => {
      zip.addLocalFile(path.resolve(process.cwd(), 'src', f), f.substring(0, f.lastIndexOf('/')))
    })
  } else {
    zip.addLocalFile(path.resolve(process.cwd(), 'src', 'package.xml'))
    ;(await getListOfSrcFiles()).map(f => {
      zip.addLocalFile(path.resolve(process.cwd(), 'src', f), f.substring(0, f.lastIndexOf('/')))
    })
  }
  const base64 = zip.toBuffer().toString('base64')
  log(chalk.green(`Zip created`))
  log(chalk.yellow('(4/4) Uploading...'))
  const deployJob = await sfdcConnector.deployMetadata(base64, {
    checkOnly: false,
    singlePackage: true,
    rollbackOnError: true,
    runTests: [
      'CtrlRaceTest',
      'CtrlNewCampaignTest',
      'WsUserManagerTest',
      'BtcAddCampaignMembersTest'
    ],
    testLevel: 'RunSpecifiedTests'
  })
  log(chalk.yellow(`Data uploaded. Polling...`))
  const deployResult = await sfdcConnector.pollDeployMetadataStatus(deployJob.id, program.testReport, r => {
    const numProcessed = parseInt(r.numberComponentsDeployed, 10) + parseInt(r.numberComponentErrors, 10)
    if (numProcessed + '' === r.numberComponentsTotal && r.runTestsEnabled === 'true' && r.numberTestsTotal !== '0') {
      log(chalk.grey(`Run tests: ${r.status} (${parseInt(r.numberTestsCompleted) + parseInt(r.numberTestErrors)}/${r.numberTestsTotal}) - Errors: ${r.numberTestErrors}`))
    } else if (r.numberComponentsTotal !== '0') {
      log(chalk.grey(`Deploy: ${r.status} (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${r.numberComponentErrors}`))
    } else {
      log(chalk.grey(`Deploy: starting...`))
    }
  })
  if (deployResult.status === 'Succeeded') {
    log(chalk.green(`Deploy succeeded`) + ' 💪')
  } else log(chalk.green(`Deploy failed`) + ' 😭')

  fs.writeFileSync('wololo.json', JSON.stringify(deployResult))
  if (program.testReport && deployResult.details.runTestResult) {
    const builder = require('junit-report-builder')
    const suite = builder.testSuite().name('Sfdc tests')
    _([
      ...[deployResult.details.runTestResult.successes],
      ...[deployResult.details.runTestResult.failures]
    ])
      .flatten()
      .filter(x => x)
      .each(x => {
        const testCase = suite.testCase()
          .className(x.name)
          .name(x.methodName)
          .time(parseInt(x.time) / 1000)
        if (x.stackTrace) {
          testCase
            .error(x.message, x.type)
            .stacktrace(x.stackTrace)
        }
      })
      .done(() => builder.writeTo('test-report.xml'))
  }
  console.timeEnd('running time')
})()
