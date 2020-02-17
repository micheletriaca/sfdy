const log = console.log
const chalk = require('chalk')

module.exports = {
  printLogo: () => {
    log(chalk.blue(`
  _____ ______ _______     __
 / ____|  ____|  __ \\ \\   / /
| (___ | |__  | |  | \\ \\_/ / 
 \\___ \\|  __| | |  | |\\   /  
 ____) | |    | |__| | | |   
|_____/|_|    |_____/  |_|                                                                   
    `))
  }
}
