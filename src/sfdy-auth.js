#!/usr/bin/env node

const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { printLogo } = require('./utils/branding-utils')
const logger = require('./services/log-service')
const program = require('commander')
const chalk = require('chalk')
const auth = require('./auth')

program
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('--client-id', 'Use a custom clientId')
  .option('--client-secret', 'Use a custom clientSecret')
  .option('--callback-port', 'Use a custom callback port')
  .option('-e, --output-eval-script <cli_type>', `If you launch ${chalk.blue('eval $(sfdy auth -e sh)')} or ${chalk.blue('Invoke-Expression "$(sfdy auth -e psh)"')} or ${chalk.blue('For /f "delims=" %A in (\'sfdy auth -e cmd\') do call %A')} then you can skip passing credentials within the current session`)
  .parse(process.argv)

const BASE_URL = `${program.sandbox ? 'test' : 'login'}.salesforce.com`
const CLIENT_ID = program.clientId || process.env.SFDY_CLIENT_ID || DEFAULT_CLIENT_ID
const CALLBACK_PORT = program.callbackPort || process.env.SFDY_OAUTH2_CALLBACK_PORT || 3000
const CLIENT_SECRET = program.clientSecret || process.env.SFDY_CLIENT_SECRET || undefined
const CLI_TYPE = program.outputEvalScript || undefined

const POWERSHELL = 'psh'
const LINUX_SHELL = 'sh'
const CMD_SHELL = 'cmd'

;(async () => {
  const { oauth2, userInfo } = await auth(BASE_URL, CLIENT_ID, CLIENT_SECRET, CALLBACK_PORT)
  if (program.outputEvalScript) {
    switch(CLI_TYPE.toLowerCase()) {
      case LINUX_SHELL:
        logger.log(`export SFDY_INSTANCE_URL=${oauth2.instance_url}`)
        logger.log(`export SFDY_REFRESH_TOKEN=${oauth2.refresh_token}`)
        break;
      case POWERSHELL:
        logger.log(`$env:SFDY_INSTANCE_URL="${oauth2.instance_url}";`)
        logger.log(`$env:SFDY_REFRESH_TOKEN="${oauth2.refresh_token}"`)
        break;
      case CMD_SHELL:
        logger.log(`set SFDY_INSTANCE_URL=${oauth2.instance_url} &&`)
        logger.log(`set SFDY_REFRESH_TOKEN=${oauth2.refresh_token}`)
        break;
      default:
        logger.log(chalk.red(`Unsupported CLI type: ${CLI_TYPE}`))
        logger.log(`Please make sure you use one of the following: ${chalk.green(LINUX_SHELL)}/${chalk.green(POWERSHELL)}/${chalk.green(CMD_SHELL)}`)
        process.exit(1)
    }
  } else {
    printLogo()
    logger.log(chalk.green('Login completed'))
    logger.log(`Username: ${chalk.green(userInfo.username)}`)
    logger.log(`Instance url: ${chalk.green(oauth2.instance_url)}`)
    logger.log(`Refresh token: ${chalk.green(oauth2.refresh_token)}`)
  }
  process.exit(0)
})()
