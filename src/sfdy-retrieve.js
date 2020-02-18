#!/usr/bin/env node

const program = require('commander')
const fs = require('fs-extra')
const path = require('path')
const pathService = require('./services/path-service')
const retrieve = require('./retrieve')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('-P, --profile-only', 'Retrieve profiles only')
  .option('-f, --files <files>', 'Retrieve specific files')
  .option('-m, --meta <metadatas>', 'Retrieve specific metadata')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

const configPath = path.resolve(pathService.getBasePath(), '.sfdy.json')
if (!fs.existsSync(configPath)) throw Error('Missing configuration file .sfdy.json')

const config = require(configPath)

retrieve({
  basePath: pathService.getBasePath(),
  config,
  files: program.files,
  loginOpts: program,
  meta: program.meta,
  profileOnly: program.profileOnly
})
