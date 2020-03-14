#!/usr/bin/env node

const program = require('commander')
const pathService = require('./services/path-service')
const configService = require('./services/config-service')
const retrieve = require('./retrieve')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('-f, --files <files>', 'Retrieve specific files')
  .option('-m, --meta <metadatas>', 'Retrieve specific metadata')
  .parse(process.argv)

if (!program.username || !program.password) {
  program.outputHelp(txt => { throw Error('Username and password are mandatory\n' + txt) })
}

retrieve({
  basePath: pathService.getBasePath(),
  config: configService.getConfig(),
  files: program.files,
  loginOpts: program,
  meta: program.meta
})
