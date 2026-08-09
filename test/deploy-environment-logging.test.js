const assert = require('assert')
const deploy = require('../src/deploy')
const logger = require('../src/services/log-service')
const Sfdc = require('../src/utils/sfdc-utils')

const originalNewInstance = Sfdc.newInstance
const previousEnvironment = process.env.environment

const runQuickDeploy = async output => deploy({
  basePath: process.cwd(),
  config: { apiVersion: '65.0' },
  loginOpts: { username: 'test@example.com', password: 'secret' },
  logger: line => output.push(String(line)),
  quickDeploy: '0Af-validation'
})

;(async () => {
  try {
    Sfdc.newInstance = async () => ({
      username: 'test@example.com',
      quickDeployMetadata: async deploymentId => {
        assert.strictEqual(deploymentId, '0Af-validation')
        return { id: '0Af-deployment' }
      },
      pollDeployMetadataStatus: async () => ({
        status: 'Succeeded',
        checkOnly: 'false',
        details: {}
      })
    })

    process.env.environment = 'uat'
    const configuredOutput = []
    await runQuickDeploy(configuredOutput)
    assert(configuredOutput.some(line => line.includes('Environment: uat')))

    delete process.env.environment
    const unconfiguredOutput = []
    await runQuickDeploy(unconfiguredOutput)
    assert(!unconfiguredOutput.some(line => line.includes('Environment:')))

    console.log('Deploy environment logging tests passed')
  } finally {
    Sfdc.newInstance = originalNewInstance
    logger.setLogger(console.log)
    if (previousEnvironment === undefined) delete process.env.environment
    else process.env.environment = previousEnvironment
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
