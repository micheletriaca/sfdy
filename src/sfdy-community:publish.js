#!/usr/bin/env node

const { program } = require('commander')
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

const options = configureAuthentication(program.opts())

;(async () => {
  console.time('running time')
  printLogo()
  if (!options.communityName) {
    logger.log(chalk.red('You must specify a community name'))
    process.exit(1)
  }
  logger.log(chalk.yellow('(1/2) Logging in salesforce...'))
  const apiVersion = (await getPackageXml()).version[0]
  const sfdcConnector = await Sfdc.newInstance({
    username: options.username,
    password: options.password,
    oauth2: getOauth2Options(options, DEFAULT_CLIENT_ID),
    isSandbox: !!options.sandbox,
    serverUrl: options.serverUrl,
    apiVersion
  })
  logger.log(chalk.green(`Logged in as ${sfdcConnector.username}!`))
  const comm = (await sfdcConnector.rest('/connect/communities'))?.communities.find(x => x.name === options.communityName)
  if (!comm) {
    logger.log(chalk.red('The specified community does not exist'))
    process.exit(1)
  }
  logger.log(chalk.yellow(`(2/2) Publishing community ${options.communityName}...`))
  const publishResult = await sfdcConnector.publishCommunity(comm.id)
  console.log(publishResult?.message)
})()
