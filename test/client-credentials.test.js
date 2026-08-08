const assert = require('assert')

const requests = []
const fetch = async (url, options = {}) => {
  requests.push({ url, ...options })
  if (url.endsWith('/services/oauth2/token')) {
    return {
      ok: true,
      json: async () => ({ access_token: 'access-token', instance_url: 'https://instance.example' })
    }
  }
  if (url === 'https://instance.example/services/oauth2/userinfo') {
    return {
      ok: true,
      json: async () => ({ username: 'ci-user@example.com' })
    }
  }
  throw new Error(`Unexpected URL: ${url}`)
}

const originalFetch = globalThis.fetch
globalThis.fetch = fetch
const Sfdc = require('../src/utils/sfdc-utils')

;(async () => {
  try {
    const connection = await Sfdc.newInstance({
      oauth2: {
        grantType: 'client_credentials',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        loginUrl: 'https://domain.example'
      },
      apiVersion: '65.0'
    })

    assert.strictEqual(connection.sessionId, 'access-token')
    assert.strictEqual(connection.username, 'ci-user@example.com')
    assert.strictEqual(requests.length, 2)
    assert.strictEqual(requests[0].method, 'POST')
    assert.strictEqual(requests[0].url, 'https://domain.example/services/oauth2/token')
    assert.strictEqual(requests[0].body, 'grant_type=client_credentials&client_id=client-id&client_secret=client-secret')
    assert.strictEqual(requests[1].headers.authorization, 'Bearer access-token')
    console.log('Client credentials flow test passed')
  } finally {
    globalThis.fetch = originalFetch
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
