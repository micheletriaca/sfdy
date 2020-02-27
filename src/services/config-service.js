const path = require('path')
const pathService = require('./path-service')
const chalk = require('chalk')
const fs = require('fs')

module.exports = {
  getConfig: () => {
    const configPath = path.resolve(pathService.getBasePath(), '.sfdy.json')
    const configExists = fs.existsSync(configPath)
    if (!configExists) console.warn(chalk.yellow('**** WARNING **** Missing configuration file .sfdy.json. To create it, just run sfdy init'))
    return configExists ? require(configPath) : {}
  }
}
