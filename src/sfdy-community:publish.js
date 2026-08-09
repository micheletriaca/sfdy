#!/usr/bin/env node

const { program } = require('commander')
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const Sfdc = require('./utils/sfdc-utils')
const { DEFAULT_CLIENT_ID } = require('./utils/constants')
const logger = require('./services/log-service')
const configService = require('./services/config-service')
const pathService = require('./services/path-service')
const { addAuthenticationOptions, getOauth2Options } = require('./utils/auth-utils')
const { resolveAuthentication } = require('./utils/credential-auth-utils')
require('./error-handling')()

addAuthenticationOptions(program)
  .option('-n, --community-name <communityName>', 'The community name')
  .parse(process.argv)

;(async () => {
  const options = await resolveAuthentication(program.opts())
  console.time('running time')
  printLogo()
  if (!options.communityName) {
    logger.log(chalk.red('You must specify a community name'))
    process.exit(1)
  }
  logger.log(chalk.yellow('(1/2) Logging in salesforce...'))
  pathService.configureProject({ config: configService.getConfig() })
  const apiVersion = pathService.getApiVersion()
  if (!apiVersion) throw new Error('Missing API version. Set apiVersion in .sfdy.json')
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
