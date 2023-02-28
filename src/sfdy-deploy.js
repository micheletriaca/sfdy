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
  .option('--refresh-token <refreshToken>', 'Refresh Token')
  .option('--instance-url <instanceUrl>', 'Instance url')
  .option('--client-id <clientId>', 'Client id')
  .option('--client-secret <clientSecret>', 'Client secret')
  .option('-f, --files <files>', 'Deploy specific files (comma separated)')
  .option('-d, --diff <branchRange>', 'Delta deploy from branch to branch - example develop..uat')
  .option('-t, --test-report', 'Generate junit test-report.xml')
  .option('--destructive [file]', 'Deploy a destructive changeset - optionally specify the path for the package.xml of the destructive changeset')
  .option('--validate', 'Simulate a deployment')
  .option('--test-level <testLevel>', 'Override default testLevel')
  .option('--quick-deploy <quickDeployId>', 'Quick deploy')
  .option('--specified-tests <specifiedTests>', 'Comma separated list of tests to execute if testlevel=RunSpecifiedTests')
  .option('--folder <folder>', 'Set alternative src folder')
  .parse(process.argv)

const hasOauth2 = !!program.refreshToken && !!program.instanceUrl
const hasUserPass = !!program.username && !!program.password
if (hasOauth2 && hasUserPass) {
  program.outputHelp(txt => { throw Error('Username + password OR refreshToken + instanceUrl are mandatory\n' + txt) })
}

const config = configService.getConfig()

if (!program.clientId && process.env.SFDY_CLIENT_ID) program.clientId = process.env.SFDY_CLIENT_ID
if (!program.clientSecret && process.env.SFDY_CLIENT_SECRET) program.clientSecret = process.env.SFDY_CLIENT_SECRET
if (!program.refreshToken && process.env.SFDY_REFRESH_TOKEN) program.refreshToken = process.env.SFDY_REFRESH_TOKEN
if (!program.instanceUrl && process.env.SFDY_INSTANCE_URL) program.instanceUrl = process.env.SFDY_INSTANCE_URL

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
    clientSecret: program.clientSecret
  },
  quickDeploy: program.quickDeploy,
  destructive: !!program.destructive,
  destructivePackage: typeof program.destructive === 'string' && program.destructive,
  checkOnly: !!program.validate,
  preDeployPlugins: config.preDeployPlugins || [],
  renderers: config.renderers || [],
  specifiedTests: program.specifiedTests,
  testLevel: program.testLevel,
  testReport: program.testReport,
  srcFolder: program.folder,
  config
}).then(deployResult => process.exit(deployResult.status !== 'Succeeded' ? 1 : 0))
