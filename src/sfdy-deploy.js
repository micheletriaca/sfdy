#!/usr/bin/env node

const program = require('commander')
const path = require('path')
const deploy = require('./deploy')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('--server-url <serverUrl>', 'Specify server url')
  .option('-f, --files <files>', 'Deploy specific files (comma separated)')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .option('--test-level <testLevel>', 'Override default testLevel')
  .option('--specified-tests <specifiedTests>', 'Comma separated list of tests to execute if testlevel=RunSpecifiedTests')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

const configPath = path.resolve(process.cwd(), '.sfdy.json')
// if (!fs.existsSync(configPath)) throw Error('Missing configuration file .sfdy.json')

const config = require(configPath)

deploy({
  diffCfg: program.diff,
  files: program.files,
  loginOpts: {
    username: program.username,
    password: program.password,
    sandbox: program.sandbox,
    serverUrl: program.serverUrl
  },
  preDeployPlugins: config.preDeployPlugins || [],
  specifiedTests: program.specifiedTests,
  testLevel: program.testLevel,
  testReport: program.testReport
}).then(deployResult => process.exit(deployResult.status !== 'Succeeded' ? 1 : 0))
