#!/usr/bin/env node

const program = require('commander')
const chalk = require('chalk')
const log = console.log
const fs = require('fs')
const path = require('path')
const decompress = require('decompress')
const b64 = require('base64-async')
const Sfdc = require('./utils/sfdc-utils')
const stripEmptyTranslations = require('./prepare/strip-empty-translations')
const stripUselessFlsInPermissionSets = require('./prepare/strip-useless-fls-in-permission-sets')
const stripPartnerRoles = require('./prepare/strip-partner-roles')
const fixProfiles = require('./prepare/fix-profiles')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

const configPath = path.resolve(process.cwd(), '.sftx.json')
if (!fs.existsSync(configPath)) throw Error('Missing configuration file .sftx.json')

const config = require(configPath)

;(async () => {
  log(chalk.green('SFTX V1.0'))
  log(chalk.yellow(`(1/4) Logging in salesforce as ${program.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: program.username,
    password: program.password,
    isSandbox: !!program.sandbox
  })
  log(chalk.green(`Logged in!`))
  const srcFolder = path.resolve(process.cwd(), 'src')
  const packageXmlPath = path.resolve(srcFolder, 'package.xml')
  log(chalk.yellow(`(2/4) Retrieving metadata...`))
  const retrieveJob = await sfdcConnector.retrieveMetadata(packageXmlPath)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  log(chalk.green(`Retrieve completed!`))
  log(chalk.yellow(`(3/4) Unzipping...`))
  const zipBuffer = await b64.decode(retrieveResult.zipFile)
  await decompress(zipBuffer, srcFolder)
  log(chalk.green(`Unzipped!`))
  log(chalk.yellow(`(4/4) Applying patches...`))
  await stripEmptyTranslations(config)
  await stripUselessFlsInPermissionSets(config)
  stripPartnerRoles(config)
  await fixProfiles(config, sfdcConnector)
  log(chalk.green(`Patches applied!`))
})()
