#!/usr/bin/env node

const { program } = require('commander')
const pathService = require('./services/path-service')
const configService = require('./services/config-service')
const retrieve = require('./retrieve')
const { addAuthenticationOptions, configureAuthentication } = require('./utils/auth-utils')
require('./error-handling')()

addAuthenticationOptions(program)
  .option('-f, --files <files>', 'Retrieve specific files')
  .option('-m, --meta <metadatas>', 'Retrieve specific metadata')
  .option('--folder <folder>', 'Set alternative source folder')
  .option('--source-format <format>', 'Project source format: metadata or sfdx')
  .parse(process.argv)

const options = configureAuthentication(program.opts())

retrieve({
  basePath: pathService.getBasePath(),
  config: configService.getConfig(),
  files: options.files,
  loginOpts: options,
  meta: options.meta,
  srcFolder: options.folder,
  sourceFormat: options.sourceFormat
})
