#!/usr/bin/env node

const program = require('commander')
const pathService = require('./services/path-service')
const configService = require('./services/config-service')
const retrieve = require('./retrieve')
require('./error-handling')()

program
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('--refresh-token <refreshToken>', 'Refresh Token')
  .option('--instance-url <instanceUrl>', 'Instance url')
  .option('--client-id <clientId>', 'Client id')
  .option('--client-secret <clientSecret>', 'Client secret')
  .option('-s, --sandbox', 'Use sandbox login endpoint')
  .option('-f, --files <files>', 'Retrieve specific files')
  .option('-m, --meta <metadatas>', 'Retrieve specific metadata')
  .parse(process.argv)

if (!program.clientId && process.env.SFDY_CLIENT_ID) program.clientId = process.env.SFDY_CLIENT_ID
if (!program.clientSecret && process.env.SFDY_CLIENT_SECRET) program.clientSecret = process.env.SFDY_CLIENT_SECRET
if (!program.refreshToken && process.env.SFDY_REFRESH_TOKEN) program.refreshToken = process.env.SFDY_REFRESH_TOKEN
if (!program.instanceUrl && process.env.SFDY_INSTANCE_URL) program.instanceUrl = process.env.SFDY_INSTANCE_URL

const hasOauth2 = !!program.refreshToken && !!program.instanceUrl
const hasUserPass = !!program.username && !!program.password
if (hasOauth2 && hasUserPass) {
  program.outputHelp(txt => { throw Error('Username + password OR refreshToken + instanceUrl are mandatory\n' + txt) })
}

retrieve({
  basePath: pathService.getBasePath(),
  config: configService.getConfig(),
  files: program.files,
  loginOpts: program,
  meta: program.meta
})
