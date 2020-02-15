const _ = require('highland')
const log = console.log
const chalk = require('chalk')

const counterGen = (n = 1) => () => `${n++}. `

const printDeployResult = (deployResult) => {
  const d = deployResult.details
  if (deployResult.status === 'Failed') {
    log(chalk.red('Request Status: Failed'))

    if (d.componentFailures) {
      log(chalk.red('\nAll Component Failures:'))
      const errCounter = counterGen()
      _([d.componentFailures]).flatten().each(x => {
        log(chalk.red(`${errCounter()} ${x.fileName} -- Error: ${x.problem} (line ${x.lineNumber}, column ${x.columnNumber})`))
      })
    }

    if (d.runTestResult && d.runTestResult.failures) {
      log(chalk.red('\nAll Test Failures:'))
      const errCounter = counterGen()
      _([d.runTestResult.failures]).flatten().each(x => {
        log(chalk.red(`${errCounter()} ${x.name}.${x.methodName} -- ${x.message}`))
        log(chalk.red(`    Stacktrace: ${x.stackTrace}`))
      })
    }

    if (d.runTestResult && d.runTestResult.codeCoverageWarnings) {
      log(chalk.red('\nCode Coverage Failures:'))
      const errCounter = counterGen()
      _([d.runTestResult.codeCoverageWarnings]).flatten().each(x => {
        log(chalk.red(`${errCounter()} ${x.name} -- ${x.message}`))
      })
    }
  }

  if (deployResult.status === 'Succeeded') {
    log(chalk.green(`\n*********** 💪  DEPLOYMENT SUCCEEDED 💪  ***********`))
  } else {
    log(chalk.red('\n*********** 😭  DEPLOYMENT FAILED 😭  ***********'))
  }
}

module.exports = printDeployResult
