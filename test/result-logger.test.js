const assert = require('assert')
const logger = require('../src/services/log-service')
const printDeployResult = require('../src/deploy/result-logger')

const nilName = Object.create(null)
nilName.$ = Object.create(null)
nilName.$['xsi:nil'] = 'true'

const output = []
logger.setLogger(line => output.push(line))

try {
  printDeployResult({
    status: 'Failed',
    details: {
      runTestResult: {
        codeCoverageWarnings: [
          {
            name: nilName,
            message: 'Average test coverage is below the required threshold.'
          },
          {
            name: 'ExampleClass',
            message: 'Example warning.'
          }
        ]
      }
    }
  })

  assert(output.some(line => line.includes('1. Average test coverage is below the required threshold.')))
  assert(output.some(line => line.includes('2. ExampleClass -- Example warning.')))
  assert(!output.some(line => line.includes('[object Object]')))
  console.log('Deploy result logger tests passed')
} finally {
  logger.setLogger(console.log)
}
