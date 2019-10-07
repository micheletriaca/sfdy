#!/usr/bin/env node

const program = require('commander')
const packageInfo = require('../package.json')

program
  .version(packageInfo.version, '-v, --version')
  .description(packageInfo.description)
  .usage('<command> [options]')
  .command('retrieve', 'Retrieve patched metadata')
  .command('deploy', 'Deploy patched metadata')
  .command('prepare', 'Patch metadata')
  .command('init', 'Create .sftx.json config file')
  .parse(process.argv)
