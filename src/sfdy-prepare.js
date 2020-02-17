#!/usr/bin/env node

const program = require('commander')
const log = console.log
const chalk = require('chalk')
const { printLogo } = require('./utils/branding-utils')
const fs = require('fs')
const Sfdc = require('./utils/sfdc-utils')
const pluginEngine = require('./plugin-engine')
const path = require('path')
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

const configPath = path.resolve(process.cwd(), '.sfdy.json')
if (!fs.existsSync(configPath)) throw Error('Missing configuration file .sfdy.json')

const config = require(configPath)

;(async () => {
  console.time('running time')
  printLogo()

  log(chalk.yellow(`(1/2) Logging in salesforce as ${program.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: program.username,
    password: program.password,
    isSandbox: !!program.sandbox
  })
  log(chalk.green(`Logged in!`))
  log(chalk.yellow(`(2/2) Applying patches...`))

  await pluginEngine.registerPlugins(config.postRetrievePlugins, sfdcConnector, program)
  await stripEmptyTranslations(config)
  await stripUselessFlsInPermissionSets(config)
  stripPartnerRoles(config)
  await fixProfiles(config)

  await pluginEngine.applyTransformationsAndWriteBack(undefined, sfdcConnector)

  log(chalk.green(`Patches applied!`))
  console.timeEnd('running time')
})()
