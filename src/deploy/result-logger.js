const _ = require('highland')
const logger = require('../services/log-service')
const chalk = require('chalk')

const counterGen = (n = 1) => () => `${n++}. `

const printDeployResult = (deployResult) => {
  const d = deployResult.details
  if (deployResult.status === 'Failed') {
    logger.log(chalk.red('Request Status: Failed'))

    if (d.componentFailures) {
      logger.log(chalk.red('\nAll Component Failures:'))
      const errCounter = counterGen()
      _([d.componentFailures]).flatten().each(x => {
        logger.log(chalk.red(`${errCounter()} ${x.fileName} -- Error: ${x.problem} (line ${x.lineNumber}, column ${x.columnNumber})`))
      })
    }

    if (d.runTestResult && d.runTestResult.failures) {
      logger.log(chalk.red('\nAll Test Failures:'))
      const errCounter = counterGen()
      _([d.runTestResult.failures]).flatten().each(x => {
        logger.log(chalk.red(`${errCounter()} ${x.name}.${x.methodName} -- ${x.message}`))
        logger.log(chalk.red(`    Stacktrace: ${x.stackTrace}`))
      })
    }

    if (d.runTestResult && d.runTestResult.codeCoverageWarnings) {
      logger.log(chalk.red('\nCode Coverage Failures:'))
      const errCounter = counterGen()
      _([d.runTestResult.codeCoverageWarnings]).flatten().each(x => {
        const warningName = typeof x.name === 'string' && x.name.trim() ? `${x.name} -- ` : ''
        logger.log(chalk.red(`${errCounter()}${warningName}${x.message}`))
      })
    }
  }

  if (deployResult.status === 'Succeeded') {
    logger.log(chalk.green(`\n*********** 💪  ${deployResult.checkOnly === 'true' ? 'VALIDATION' : 'DEPLOYMENT'} SUCCEEDED 💪  ***********`))
  } else {
    logger.log(chalk.red(`\n*********** 😭  ${deployResult.checkOnly === 'true' ? 'VALIDATION' : 'DEPLOYMENT'} FAILED 😭  ***********`))
  }
}

module.exports = printDeployResult
