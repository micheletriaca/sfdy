const _ = require('highland')
const logger = require('../services/log-service')
const chalk = require('chalk')

const counterGen = (n = 1) => () => `${n++}. `

const pollCallback = typeOfDeploy => r => {
  const numProcessed = r.numberComponentsDeployed + r.numberComponentErrors
  if (numProcessed === r.numberComponentsTotal && r.runTestsEnabled && r.numberTestsTotal) {
    const errors = chalk[r.numberTestErrors > 0 ? 'red' : 'green'](r.numberTestErrors)
    const numProcessed = r.numberTestsCompleted + r.numberTestErrors
    logger.log(chalk.grey(`Run tests: (${numProcessed}/${r.numberTestsTotal}) - Errors: ${errors}`))
  } else if (r.numberComponentsTotal) {
    const errors = chalk[r.numberComponentErrors > 0 ? 'red' : 'green'](r.numberComponentErrors)
    logger.log(chalk.grey(`${typeOfDeploy}: (${numProcessed}/${r.numberComponentsTotal}) - Errors: ${errors}`))
  } else {
    logger.log(chalk.grey(`${typeOfDeploy}: starting...`))
  }
}

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
        logger.log(chalk.red(`${errCounter()} ${x.name} -- ${x.message}`))
      })
    }
  }

  if (deployResult.status === 'Succeeded') {
    logger.log(chalk.green(`\n*********** 💪  ${deployResult.checkOnly === 'true' ? 'VALIDATION' : 'DEPLOYMENT'} SUCCEEDED 💪  ***********`))
  } else {
    logger.log(chalk.red(`\n*********** 😭  ${deployResult.checkOnly === 'true' ? 'VALIDATION' : 'DEPLOYMENT'} FAILED 😭  ***********`))
  }
}

module.exports = {
  printDeployResult,
  pollCallback
}
