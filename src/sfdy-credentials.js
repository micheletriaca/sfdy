#!/usr/bin/env node

const { program } = require('commander')
const chalk = require('chalk')
const credentials = require('./credentials')
require('./error-handling')()

program
  .description('Manage saved Salesforce credentials')
  .option('--json', 'Print the credential catalog as JSON')
  .option('--remove <target>', 'Remove a saved credential')
  .parse(process.argv)

;(async () => {
  const options = program.opts()
  if (options.remove) {
    const removed = await credentials.remove(options.remove)
    if (!removed) throw new Error(`No saved Salesforce credential matches '${options.remove}'`)
    console.log(`Removed ${chalk.green(options.remove)}`)
    return
  }

  const profiles = await credentials.list()
  if (options.json) {
    console.log(JSON.stringify(profiles, null, 2))
    return
  }
  if (profiles.length === 0) {
    console.log('No saved Salesforce credentials. Run sfdy auth --save to add one.')
    return
  }
  profiles.forEach(profile => {
    console.log(`${chalk.green(profile.alias)}\t${profile.username}${profile.environment ? `\t${profile.environment}` : ''}`)
  })
})()
