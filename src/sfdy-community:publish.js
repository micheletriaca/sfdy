#!/usr/bin/env node

const program = require('commander')
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const Sfdc = require('./utils/sfdc-utils')
const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const { getPackageXml } = require('./utils/package-utils')
const logger = require('./services/log-service')
const { addAuthenticationOptions, configureAuthentication, getOauth2Options } = require('./utils/auth-utils')
require('./error-handling')()

addAuthenticationOptions(program)
  .option('-n, --community-name <communityName>', 'The community name')
  .parse(process.argv)

configureAuthentication(program)

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
    oauth2: getOauth2Options(program, DEFAULT_CLIENT_ID),
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
