const chalk = require('chalk')

const handleError = e => {
  if (process.env.DEBUG === 'true') console.error(e)
  else console.error(chalk.red(typeof (e) === 'string' ? e : e.message))
  process.exit(1)
}

module.exports = () => {
  process.on('uncaughtException', handleError)
  process.on('unhandledRejection', handleError)
}
