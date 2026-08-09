const assert = require('assert')
const {
  AUTH_ERROR,
  CLIENT_CREDENTIALS_URL_ERROR,
  configureAuthentication,
  getOauth2Options
} = require('../src/utils/auth-utils')
const { resolveAuthentication } = require('../src/utils/credential-auth-utils')

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
  assert.strictEqual(configureAuthentication({ username: 'user', refreshToken: 'token', instanceUrl: 'https://example.my.salesforce.com' }).clientCredentials, false)
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

const runResolutionTests = async () => {
  const profiles = [
    {
      id: 'dev-id',
      alias: 'acme-dev',
      username: 'developer@example.com',
      environment: 'dev',
      instanceUrl: 'https://acme.my.salesforce.com',
      refreshToken: 'dev-token',
      clientId: 'saved-client-id'
    },
    {
      id: 'uat-id',
      alias: 'acme-uat',
      username: 'developer@example.com.uat',
      environment: 'uat',
      instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com',
      refreshToken: 'uat-token'
    }
  ]
  const credentialManager = {
    list: async () => profiles.map(profile => {
      const metadata = { ...profile }
      delete metadata.refreshToken
      return metadata
    }),
    get: async selector => profiles.find(profile => [profile.id, profile.alias, profile.username].includes(selector))
  }
  const previousEnvironment = process.env.environment
  try {
    const explicit = await resolveAuthentication({ username: 'user', password: 'secret' }, { credentialManager })
    assert.strictEqual(explicit.password, 'secret')

    const selected = await resolveAuthentication({ target: 'acme-uat' }, { credentialManager })
    assert.strictEqual(selected.refreshToken, 'uat-token')
    assert.strictEqual(selected.environment, 'uat')

    const supplemented = await resolveAuthentication({
      target: 'acme-dev',
      clientSecret: 'explicit-client-secret'
    }, { credentialManager })
    assert.strictEqual(supplemented.clientId, 'saved-client-id')
    assert.strictEqual(supplemented.clientSecret, 'explicit-client-secret')
    assert.strictEqual(supplemented.refreshToken, 'dev-token')

    const byUsername = await resolveAuthentication({ username: 'developer@example.com' }, { credentialManager })
    assert.strictEqual(byUsername.refreshToken, 'dev-token')

    await assert.rejects(
      resolveAuthentication({}, { credentialManager, interactive: false }),
      error => error.message.includes('--target')
    )

    const singleManager = {
      list: async () => [profiles[0]],
      get: async () => profiles[0]
    }
    await assert.rejects(
      resolveAuthentication({}, { credentialManager: singleManager, interactive: false }),
      error => error.message.includes('--target')
    )
    assert.strictEqual((await resolveAuthentication({}, {
      credentialManager: singleManager,
      interactive: true,
      select: async availableProfiles => availableProfiles[0]
    })).refreshToken, 'dev-token')

    assert.strictEqual((await resolveAuthentication({}, {
      credentialManager,
      interactive: true,
      select: async availableProfiles => availableProfiles[1]
    })).refreshToken, 'uat-token')
  } finally {
    if (previousEnvironment === undefined) delete process.env.environment
    else process.env.environment = previousEnvironment
  }

  console.log('Authentication option tests passed')
}

runResolutionTests()
