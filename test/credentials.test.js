const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setTimeout: delay } = require('node:timers/promises')
const {
  CredentialSelectionError,
  CredentialStoreUnavailableError,
  createCredentialManager,
  getVaultPath
} = require('../src/credentials')
const { resolveAuthentication } = require('../src/utils/credential-auth-utils')
const { getOauth2Options } = require('../src/utils/auth-utils')
const { DEFAULT_CLIENT_ID } = require('../src/utils/constants')
const { newInstance } = require('../src/utils/sfdc-utils')

const testOAuthRotation = async (credentials, otherManager) => {
  const options = await resolveAuthentication({ target: 'acme-dev' }, { credentialManager: credentials })
  const staleOptions = await resolveAuthentication({ target: 'acme-dev' }, { credentialManager: otherManager })
  const connect = login => newInstance({
    username: login.username,
    oauth2: getOauth2Options(login, DEFAULT_CLIENT_ID),
    apiVersion: '65.0'
  })
  const originalFetch = globalThis.fetch
  const requests = []
  let currentToken = 'rotated-secret'
  let instanceUrl = 'https://acme.my.salesforce.com'
  let rejectRefresh = false
  globalThis.fetch = async (url, { body }) => {
    const request = new URLSearchParams(body)
    assert.strictEqual(request.get('client_id'), DEFAULT_CLIENT_ID)
    assert.strictEqual(request.has('client_secret'), false)
    assert.strictEqual(url, `${instanceUrl}/services/oauth2/token`)
    const token = request.get('refresh_token')
    requests.push(token)
    await delay(25)
    if (rejectRefresh || token !== currentToken) {
      return { ok: false, json: async () => ({ error: 'invalid_grant' }) }
    }
    if (requests.length > 2) {
      return { ok: true, json: async () => ({ access_token: 'access', instance_url: instanceUrl }) }
    }
    currentToken = `new-token-${requests.length}`
    instanceUrl = 'https://new-acme.my.salesforce.com'
    const response = { access_token: 'access', instance_url: instanceUrl, refresh_token: currentToken }
    return { ok: true, json: async () => response }
  }

  try {
    const [first, second] = await Promise.all([connect(options), connect(staleOptions)])
    assert.strictEqual(first.sessionId, 'access')
    assert.strictEqual(second.instanceUrl, instanceUrl)
    assert.deepStrictEqual(requests, ['rotated-secret', 'new-token-1'])
    await credentials.update(options.credential.id, { environment: 'new-dev' })
    await connect(staleOptions)
    rejectRefresh = true
    await assert.rejects(connect(options), { name: 'SalesforceOAuthError', message: 'invalid_grant' })
    rejectRefresh = false
    await connect(staleOptions)
    assert.deepStrictEqual(requests.slice(2), ['new-token-2', 'new-token-2', 'new-token-2'])
    const saved = await credentials.get('acme-dev')
    assert.strictEqual(saved.refreshToken, 'new-token-2')
    assert.strictEqual(saved.instanceUrl, instanceUrl)
    assert.strictEqual(saved.environment, 'new-dev')
    assert.strictEqual(saved.sessionId, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
}

const run = async () => {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-credentials-'))
  const vaultPath = getVaultPath({ basePath: temporaryDirectory })
  const keys = new Map()
  const backend = {
    get: async account => keys.get(account),
    set: async (account, value) => keys.set(account, value),
    delete: async account => keys.delete(account)
  }
  const credentials = createCredentialManager({ basePath: temporaryDirectory, backend })

  try {
    assert.deepStrictEqual(await credentials.list(), [])

    const saved = await credentials.save({
      alias: 'acme-dev',
      environment: 'dev',
      username: 'developer@example.com',
      instanceUrl: 'https://acme.my.salesforce.com',
      refreshToken: 'super-secret'
    })
    assert.ok(saved.id)
    assert.strictEqual(saved.alias, 'acme-dev')
    assert.strictEqual(keys.size, 1)
    assert.strictEqual(Buffer.from([...keys.values()][0], 'base64').length, 32)

    const encryptedVault = await fs.promises.readFile(vaultPath, 'utf8')
    const envelope = JSON.parse(encryptedVault)
    assert.ok(envelope.id)
    assert.ok([...keys.keys()][0].endsWith(envelope.id))
    assert.ok(!encryptedVault.includes('developer@example.com'))
    assert.ok(!encryptedVault.includes('super-secret'))
    assert.ok((await fs.promises.readFile(path.join(temporaryDirectory, '.gitignore'), 'utf8')).includes('/.sfdy/'))
    if (process.platform !== 'win32') assert.strictEqual((await fs.promises.stat(vaultPath)).mode & 0o777, 0o600)

    assert.strictEqual((await credentials.list())[0].refreshToken, undefined)
    assert.strictEqual((await credentials.get('acme-dev')).refreshToken, 'super-secret')
    assert.strictEqual((await credentials.get('developer@example.com')).environment, 'dev')

    const updated = await credentials.save({
      alias: 'acme-dev',
      username: 'developer@example.com',
      instanceUrl: 'https://acme.my.salesforce.com',
      refreshToken: 'rotated-secret'
    })
    assert.strictEqual(updated.id, saved.id)
    assert.strictEqual((await credentials.get('acme-dev')).refreshToken, 'rotated-secret')
    await testOAuthRotation(credentials, createCredentialManager({ basePath: temporaryDirectory, backend }))

    const test = await credentials.save({
      alias: 'acme-test',
      username: 'developer@example.com',
      instanceUrl: 'https://acme--test.sandbox.my.salesforce.com',
      refreshToken: 'test-secret'
    })
    await assert.rejects(credentials.get('developer@example.com'), CredentialSelectionError)
    assert.strictEqual((await credentials.get('acme-test')).refreshToken, 'test-secret')
    assert.strictEqual((await credentials.get('acme-test')).environment, 'acme-test')
    assert.ok(test.id)

    assert.strictEqual(await credentials.remove('acme-test'), true)
    assert.strictEqual(await credentials.remove('missing'), false)
    assert.strictEqual((await credentials.list()).length, 1)

    keys.clear()
    await assert.rejects(credentials.list(), CredentialStoreUnavailableError)
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
  }

  console.log('Credential manager tests passed')
}

run()
