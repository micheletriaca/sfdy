#!/usr/bin/env node

const { program } = require('commander')
const deploy = require('./deploy')
const configService = require('./services/config-service')
const { addAuthenticationOptions } = require('./utils/auth-utils')
const { resolveAuthentication } = require('./utils/credential-auth-utils')
const { printLogo } = require('./utils/branding-utils')
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
  .option('--source-format <format>', 'Project source format: metadata or sfdx')
  .parse(process.argv)

;(async () => {
  const config = configService.getConfig()
  const options = await resolveAuthentication(program.opts())
  printLogo()
  const deployResult = await deploy({
    diffCfg: options.diff,
    files: options.files,
    loginOpts: {
      username: options.username,
      password: options.password,
      sandbox: options.sandbox,
      serverUrl: options.serverUrl,
      refreshToken: options.refreshToken,
      instanceUrl: options.instanceUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      clientCredentials: options.clientCredentials
    },
    quickDeploy: options.quickDeploy,
    destructive: !!options.destructive,
    destructivePackage: typeof options.destructive === 'string' && options.destructive,
    ignoreWarnings: !!options.ignoreWarnings,
    checkOnly: !!options.validate,
    preDeployPlugins: config.preDeployPlugins || [],
    renderers: config.renderers || [],
    specifiedTests: options.specifiedTests,
    testLevel: options.testLevel,
    testReport: options.testReport,
    srcFolder: options.folder,
    sourceFormat: options.sourceFormat,
    config
  })
  process.exit(deployResult.status !== 'Succeeded' ? 1 : 0)
})()
