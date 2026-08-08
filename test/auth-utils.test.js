const assert = require('assert')
const { AUTH_ERROR, CLIENT_CREDENTIALS_URL_ERROR, configureAuthentication, getOauth2Options } = require('../src/utils/auth-utils')

const withEnvironment = (environment, callback) => {
  const names = ['SFDY_CLIENT_ID', 'SFDY_CLIENT_SECRET', 'SFDY_REFRESH_TOKEN', 'SFDY_INSTANCE_URL', 'SFDY_SERVER_URL']
  const previous = {}
  names.forEach(name => { previous[name] = process.env[name] })
  names.forEach(name => delete process.env[name])
  Object.assign(process.env, environment)
  try {
    callback()
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    })
  }
}

withEnvironment({}, () => {
  assert.strictEqual(configureAuthentication({ username: 'user', password: 'secret' }).clientCredentials, false)
  assert.strictEqual(configureAuthentication({ refreshToken: 'token', instanceUrl: 'https://example.my.salesforce.com' }).clientCredentials, false)
  assert.strictEqual(configureAuthentication({ clientId: 'id', clientSecret: 'secret', serverUrl: 'https://example.my.salesforce.com' }).clientCredentials, true)
  assert.throws(() => configureAuthentication({ clientId: 'id', clientSecret: 'secret' }), error => error.message === CLIENT_CREDENTIALS_URL_ERROR)
  assert.throws(() => configureAuthentication({ clientId: 'id' }), error => error.message === AUTH_ERROR)
  assert.throws(() => configureAuthentication({}), error => error.message === AUTH_ERROR)
})

withEnvironment({ SFDY_CLIENT_ID: 'env-id', SFDY_CLIENT_SECRET: 'env-secret', SFDY_SERVER_URL: 'https://example.my.salesforce.com' }, () => {
  const options = configureAuthentication({})
  assert.strictEqual(options.clientId, 'env-id')
  assert.strictEqual(options.clientSecret, 'env-secret')
  assert.strictEqual(options.serverUrl, 'https://example.my.salesforce.com')
  assert.strictEqual(options.clientCredentials, true)
})

assert.deepStrictEqual(getOauth2Options({
  clientId: 'library-id',
  clientSecret: 'library-secret',
  serverUrl: 'https://library.my.salesforce.com'
}), {
  grantType: 'client_credentials',
  clientId: 'library-id',
  clientSecret: 'library-secret',
  loginUrl: 'https://library.my.salesforce.com'
})

console.log('Authentication option tests passed')
