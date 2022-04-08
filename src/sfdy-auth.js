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
  .option('-e, --output-eval-script', 'If you launch eval $(sfdy auth -e) then you can skip passing credentials within the current session')
  .parse(process.argv)

const BASE_URL = `${program.sandbox ? 'test' : 'login'}.salesforce.com`
const CLIENT_ID = program.clientId || process.env.SFDY_CLIENT_ID || DEFAULT_CLIENT_ID
const CALLBACK_PORT = program.callbackPort || process.env.SFDY_OAUTH2_CALLBACK_PORT || 3000
const CLIENT_SECRET = program.clientSecret || process.env.SFDY_CLIENT_SECRET || undefined

;(async () => {
  const { oauth2, userInfo } = await auth(BASE_URL, CLIENT_ID, CLIENT_SECRET, CALLBACK_PORT)
  if (program.outputEvalScript) {
    logger.log(`export SFDY_INSTANCE_URL=${oauth2.instance_url}`)
    logger.log(`export SFDY_REFRESH_TOKEN=${oauth2.refresh_token}`)
  } else {
    printLogo()
    logger.log(chalk.green(`Login completed`))
    logger.log(`Username: ${userInfo.username}`)
  }
  process.exit(0)
})()
