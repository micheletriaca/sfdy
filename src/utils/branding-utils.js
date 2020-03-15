const logger = require('../services/log-service')
const chalk = require('chalk')

module.exports = {
  printLogo: () => {
    logger.log(chalk.blue(`
  _____ ______ _______     __
 / ____|  ____|  __ \\ \\   / /
| (___ | |__  | |  | \\ \\_/ / 
 \\___ \\|  __| | |  | |\\   /  
 ____) | |    | |__| | | |   
|_____/|_|    |_____/  |_|                                                                   
    `))
  }
}
