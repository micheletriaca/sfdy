#!/usr/bin/env node

const program = require('commander')
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const Sfdc = require('./utils/sfdc-utils')
const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { getPackageXml } = require('./utils/package-utils')
const logger = require('./services/log-service')
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
  .option('-n, --community-name <communityName>', 'The community name')
  .parse(process.argv)

const hasOauth2 = !!program.refreshToken && !!program.instanceUrl
const hasUserPass = !!program.username && !!program.password
if (hasOauth2 && hasUserPass) {
  program.outputHelp(txt => { throw Error('Username + password OR refreshToken + instanceUrl are mandatory\n' + txt) })
}

if (!program.clientId && process.env.SFDY_CLIENT_ID) program.clientId = process.env.SFDY_CLIENT_ID
if (!program.clientSecret && process.env.SFDY_CLIENT_SECRET) program.clientSecret = process.env.SFDY_CLIENT_SECRET
if (!program.refreshToken && process.env.SFDY_REFRESH_TOKEN) program.refreshToken = process.env.SFDY_REFRESH_TOKEN
if (!program.instanceUrl && process.env.SFDY_INSTANCE_URL) program.instanceUrl = process.env.SFDY_INSTANCE_URL

;(async () => {
  console.time('running time')
  printLogo()
  if (!program.communityName) {
    logger.log(chalk.red('You must specify a community name'))
    process.exit(1)
  }
  logger.log(chalk.yellow('(1/2) Logging in salesforce...'))
  const apiVersion = (await getPackageXml()).version[0]
  const sfdcConnector = await Sfdc.newInstance({
    username: program.username,
    password: program.password,
    oauth2: program.refreshToken && program.instanceUrl
      ? {
          refreshToken: program.refreshToken,
          instanceUrl: program.instanceUrl,
          clientId: program.clientId || DEFAULT_CLIENT_ID,
          clientSecret: program.clientSecret || undefined
        }
      : undefined,
    isSandbox: !!program.sandbox,
    serverUrl: program.serverUrl,
    apiVersion
  })
  logger.log(chalk.green(`Logged in as ${sfdcConnector.username}!`))
  const comm = (await sfdcConnector.rest('/connect/communities'))?.communities.find(x => x.name === program.communityName)
  if (!comm) {
    logger.log(chalk.red('The specified community does not exist'))
    process.exit(1)
  }
  logger.log(chalk.yellow(`(2/2) Publishing community ${program.communityName}...`))
  const publishResult = await sfdcConnector.publishCommunity(comm.id)
  console.log(publishResult?.message)
})()
