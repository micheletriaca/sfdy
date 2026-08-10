#!/usr/bin/env node

const { program } = require('commander')
const packageInfo = require('../package.json')

program
  .version(packageInfo.version, '-v, --version')
  .description(packageInfo.description)
  .usage('<command> [options]')
  .command('create', 'Create or connect a Salesforce project')
  .command('retrieve', 'Retrieve patched metadata')
  .command('deploy', 'Deploy patched metadata')
  .command('community:publish', 'Publish community')
  .command('prepare', 'Patch metadata')
  .command('convert', 'Convert the project to the opposite source format')
  .command('init', 'Create .sfdy.json config file')
  .command('auth', 'Obtain a refresh token with the OAuth 2.0 web server flow')
  .command('credentials', 'Manage saved Salesforce credentials')
  .parse(process.argv)
