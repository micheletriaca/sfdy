#!/usr/bin/env node

const program = require('commander')
const chalk = require('chalk')
const log = console.log
const path = require('path')
const AdmZip = require('adm-zip')
const Sfdc = require('./utils/sfdc-utils')
const { buildXml } = require('./utils/xml-utils')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('./utils/package-utils')
const buildJunitTestReport = require('./deploy/junit-test-report-builder')
const printDeployResult = require('./deploy/result-logger')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('-f, --files <files>', 'Deploy specific files (comma separated)')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .option('--test-level <testLevel>', 'Override default testLevel')
  .option('--specified-tests <specifiedTests>', 'Comma separated list of tests to execute if testlevel=RunSpecifiedTests')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

;(async () => {
  console.time('running time')
  log(chalk.green('SFDY V1.0'))
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
    const packageMapping = await getPackageMapping(sfdcConnector)
    ;(await getListOfSrcFiles(packageMapping, specificFiles)).map(f => {
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
  const testOptions = {}
  if (program.specifiedTests) testOptions.runTests = program.specifiedTests.split(',').map(x => x.trim())
  if (program.testLevel) testOptions.testLevel = program.testLevel
  const deployJob = await sfdcConnector.deployMetadata(base64, Object.assign(testOptions, {
    checkOnly: false,
    singlePackage: true,
    rollbackOnError: true
  }))
  log(chalk.yellow(`Data uploaded. Polling...`))
  const deployResult = await sfdcConnector.pollDeployMetadataStatus(deployJob.id, program.testReport, r => {
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
  if (program.testReport && d.runTestResult) {
    await buildJunitTestReport(d.runTestResult)
  }

  printDeployResult(deployResult)

  console.timeEnd('running time')
  process.exit(deployResult.status === 'Failed' ? 1 : 0)
})()
