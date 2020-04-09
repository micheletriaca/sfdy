#!/usr/bin/env node

const program = require('commander')
const deploy = require('./deploy')
const configService = require('./services/config-service')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('--server-url <serverUrl>', 'Specify server url')
  .option('-f, --files <files>', 'Deploy specific files (comma separated)')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .option('--destructive', 'Deploy a destructive changeset')
  .option('--validate', 'Simulate a deployment')
  .option('--test-level <testLevel>', 'Override default testLevel')
  .option('--specified-tests <specifiedTests>', 'Comma separated list of tests to execute if testlevel=RunSpecifiedTests')
  .option('--folder <folder>', 'Set alternative src folder')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

const config = configService.getConfig()

deploy({
  diffCfg: program.diff,
  files: program.files,
  loginOpts: {
    username: program.username,
    password: program.password,
    sandbox: program.sandbox,
    serverUrl: program.serverUrl
  },
  destructive: !!program.destructive,
  checkOnly: !!program.validate,
  preDeployPlugins: config.preDeployPlugins || [],
  renderers: config.renderers || [],
  specifiedTests: program.specifiedTests,
  testLevel: program.testLevel,
  testReport: program.testReport,
  srcFolder: program.folder,
  config
}).then(deployResult => process.exit(deployResult.status !== 'Succeeded' ? 1 : 0))
