#!/usr/bin/env node

const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { printLogo } = require('./utils/branding-utils')
const logger = require('./services/log-service')
const { program } = require('commander')
const chalk = require('chalk')
const auth = require('./auth')
const credentials = require('./credentials')
const { askRequired, confirm } = require('./utils/prompt-utils')
require('./error-handling')()

program
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('--client-id <clientId>', 'Use a custom clientId')
  .option('--client-secret <clientSecret>', 'Use a custom clientSecret')
  .option('--callback-port <port>', 'Use a custom callback port')
  .option('--alias <alias>', 'Alias for the saved credential')
  .option('--environment <environment>', 'Environment name exposed to metadata plugins (defaults to alias)')
  .option('--save', 'Save the credential securely for future commands')
  .option('-e, --output-eval-script', 'If you launch eval $(sfdy auth -e) then you can skip passing credentials within the current session')
  .parse(process.argv)

const options = program.opts()
if (options.save && !options.alias && !process.stdin.isTTY) {
  throw new Error('Saving a credential non-interactively requires --alias')
}
const BASE_URL = `${options.sandbox ? 'test' : 'login'}.salesforce.com`
const CLIENT_ID = options.clientId || process.env.SFDY_CLIENT_ID || DEFAULT_CLIENT_ID
const CALLBACK_PORT = options.callbackPort || process.env.SFDY_OAUTH2_CALLBACK_PORT || 3000
const CLIENT_SECRET = options.clientSecret || process.env.SFDY_CLIENT_SECRET || undefined

;(async () => {
  const { oauth2, userInfo } = await auth(BASE_URL, CLIENT_ID, CLIENT_SECRET, CALLBACK_PORT)
  const shouldSave = options.save || (!options.outputEvalScript && process.stdin.isTTY && await confirm('Save this login securely?'))
  let saved
  if (shouldSave) {
    const alias = options.alias || (process.stdin.isTTY
      ? await askRequired('Credential alias: ')
      : undefined)
    if (!alias) throw new Error('Saving a credential requires --alias')
    try {
      saved = await credentials.save({
        alias,
        environment: options.environment || alias,
        username: userInfo.username,
        instanceUrl: oauth2.instance_url,
        refreshToken: oauth2.refresh_token,
        clientId: options.clientId,
        clientSecret: options.clientSecret
      })
    } catch (error) {
      logger.log(chalk.yellow(`Could not save the credential securely: ${error.message}`))
    }
  }
  if (options.outputEvalScript) {
    logger.log(`export SFDY_INSTANCE_URL=${oauth2.instance_url}`)
    logger.log(`export SFDY_REFRESH_TOKEN=${oauth2.refresh_token}`)
  } else {
    printLogo()
    logger.log(chalk.green('Login completed'))
    logger.log(`Username: ${chalk.green(userInfo.username)}`)
    logger.log(`Instance url: ${chalk.green(oauth2.instance_url)}`)
    if (saved) logger.log(`Saved credential: ${chalk.green(saved.alias)}`)
    else logger.log(`Refresh token: ${chalk.green(oauth2.refresh_token)}`)
  }
  process.exit(0)
})()
