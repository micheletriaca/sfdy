#!/usr/bin/env node

const { program } = require('commander')
const chalk = require('chalk')
const convert = require('./convert')
const configService = require('./services/config-service')
const logger = require('./services/log-service')
const { addAuthenticationOptions } = require('./utils/auth-utils')
const { resolveAuthentication } = require('./utils/credential-auth-utils')
const { printLogo } = require('./utils/branding-utils')
require('./error-handling')()

addAuthenticationOptions(program)
  .option('--to <format>', 'Target format: metadata/mdapi or sfdx/source')
  .option('--folder <folder>', 'Target source folder (defaults to the current source folder)')
  .action(async options => {
    printLogo()
    const loginOpts = await resolveAuthentication(options)
    const result = await convert({
      config: configService.getConfig(),
      loginOpts,
      targetFormat: options.to,
      targetFolder: options.folder
    })
    logger.log(chalk.green(`Converted project to ${result.sourceFormat} format in ${result.sourceFolder}`))
  })
  .parseAsync(process.argv)
