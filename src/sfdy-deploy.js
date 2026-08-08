#!/usr/bin/env node

const program = require('commander')
const deploy = require('./deploy')
const configService = require('./services/config-service')
const { addAuthenticationOptions, configureAuthentication } = require('./utils/auth-utils')
require('./error-handling')()

addAuthenticationOptions(program)
  .option('-f, --files <files>', 'Deploy specific files (comma separated)')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .option('--destructive [file]', 'Deploy a destructive changeset - optionally specify the path for the package.xml of the destructive changeset')
  .option('--ignoreWarnings', 'Ignore deploy warnings')
  .option('--validate', 'Simulate a deployment')
  .option('--test-level <testLevel>', 'Override default testLevel')
  .option('--quick-deploy <quickDeployId>', 'Quick deploy')
  .option('--specified-tests <specifiedTests>', 'Comma separated list of tests to execute if testlevel=RunSpecifiedTests')
  .option('--folder <folder>', 'Set alternative src folder')
  .parse(process.argv)

const config = configService.getConfig()
configureAuthentication(program)

deploy({
  diffCfg: program.diff,
  files: program.files,
  loginOpts: {
    username: program.username,
    password: program.password,
    sandbox: program.sandbox,
    serverUrl: program.serverUrl,
    refreshToken: program.refreshToken,
    instanceUrl: program.instanceUrl,
    clientId: program.clientId,
    clientSecret: program.clientSecret,
    clientCredentials: program.clientCredentials
  },
  quickDeploy: program.quickDeploy,
  destructive: !!program.destructive,
  destructivePackage: typeof program.destructive === 'string' && program.destructive,
  ignoreWarnings: !!program.ignoreWarnings,
  checkOnly: !!program.validate,
  preDeployPlugins: config.preDeployPlugins || [],
  renderers: config.renderers || [],
  specifiedTests: program.specifiedTests,
  testLevel: program.testLevel,
  testReport: program.testReport,
  srcFolder: program.folder,
  config
}).then(deployResult => process.exit(deployResult.status !== 'Succeeded' ? 1 : 0))
