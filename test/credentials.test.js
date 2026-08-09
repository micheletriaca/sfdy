const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CredentialSelectionError,
  CredentialStoreUnavailableError,
  createCredentialManager,
  getVaultPath
} = require('../src/credentials')

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
