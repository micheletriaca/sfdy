const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PassThrough } = require('stream')
const {
  DEFAULT_METADATA,
  chooseLoginHost,
  createProject,
  detectProject,
  normalizeLoginHost,
  parseMetadataSelection
} = require('../src/create')

const temporaryDirectories = []
const temporaryDirectory = async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-create-'))
  temporaryDirectories.push(directory)
  return directory
}

const output = () => new PassThrough()
const authenticationEnvironmentNames = [
  'SFDY_REFRESH_TOKEN',
  'SFDY_INSTANCE_URL',
  'SFDY_CLIENT_ID',
  'SFDY_CLIENT_SECRET',
  'SFDY_SERVER_URL'
]
const previousAuthenticationEnvironment = Object.fromEntries(
  authenticationEnvironmentNames.map(name => [name, process.env[name]])
)

;(async () => {
  try {
    assert.deepStrictEqual(parseMetadataSelection(), DEFAULT_METADATA)
    assert.deepStrictEqual(parseMetadataSelection('1, LightningComponentBundle, CustomObject/Invoice__c'), [
      'ApexClass/*',
      'LightningComponentBundle/*',
      'CustomObject/Invoice__c'
    ])
    assert.throws(() => parseMetadataSelection('99'), /Unknown metadata choice/)
    assert.strictEqual(normalizeLoginHost('https://acme.my.salesforce.com/'), 'acme.my.salesforce.com')
    assert.throws(() => normalizeLoginHost('https://acme.my.salesforce.com/services'), /must not contain a path/)
    assert.strictEqual(await chooseLoginHost({
      options: { sandbox: true },
      output: output()
    }), 'test.salesforce.com')

    const existing = await temporaryDirectory()
    await fs.promises.mkdir(path.join(existing, 'force-app', 'main', 'default'), { recursive: true })
    await fs.promises.writeFile(path.join(existing, 'sfdx-project.json'), JSON.stringify({
      packageDirectories: [{ path: 'force-app', default: true }],
      sourceApiVersion: '66.0'
    }))
    const detected = detectProject(existing)
    assert.strictEqual(detected.sourceFormat, 'sfdx')
    assert.strictEqual(detected.sourceFolder, path.join('force-app', 'main', 'default'))
    assert.strictEqual(detected.apiVersion, '66.0')

    const sfdxDirectory = await temporaryDirectory()
    let sfdxRetrieve
    const sfdxResult = await createProject({
      directory: sfdxDirectory,
      sourceFormat: 'sfdx',
      apiVersion: '66',
      metadata: 'ApexClass,LightningComponentBundle',
      username: 'developer@example.com',
      password: 'secret'
    }, {
      interactive: false,
      output: output(),
      credentialManager: { list: async () => [] },
      retrieve: async options => { sfdxRetrieve = options }
    })
    assert.strictEqual(sfdxResult.config.apiVersion, '66.0')
    assert.strictEqual(sfdxRetrieve.sourceFormat, 'sfdx')
    assert.strictEqual(sfdxRetrieve.srcFolder, 'force-app/main/default')
    assert.strictEqual(sfdxRetrieve.meta, 'ApexClass/*,LightningComponentBundle/*')
    assert.strictEqual(fs.existsSync(path.join(sfdxDirectory, 'force-app', 'main', 'default')), true)
    assert.deepStrictEqual(readJson(path.join(sfdxDirectory, 'sfdx-project.json')).packageDirectories, [
      { path: 'force-app', default: true }
    ])

    const metadataDirectory = await temporaryDirectory()
    let savedProfile
    let metadataRetrieve
    process.env.SFDY_REFRESH_TOKEN = 'expired-shell-token'
    process.env.SFDY_INSTANCE_URL = 'https://stale.example.my.salesforce.com'
    const metadataResult = await createProject({
      directory: metadataDirectory,
      sourceFormat: 'metadata',
      apiVersion: '65.0',
      metadata: 'ApexTrigger',
      clientId: 'custom-client-id',
      clientSecret: 'custom-client-secret',
      save: true
    }, {
      interactive: true,
      output: output(),
      credentialManager: {
        list: async () => [],
        save: async profile => {
          savedProfile = profile
          return { ...profile, id: 'credential-id' }
        }
      },
      authenticate: async (host, clientId, clientSecret) => {
        assert.strictEqual(host, 'acme--dev.sandbox.my.salesforce.com')
        assert.strictEqual(clientId, 'custom-client-id')
        assert.strictEqual(clientSecret, 'custom-client-secret')
        return {
          oauth2: {
            instance_url: 'https://example.my.salesforce.com',
            refresh_token: 'refresh-token'
          },
          userInfo: { username: 'developer@example.com' }
        }
      },
      ask: async question => question.includes('login type') ? '3' : '',
      askRequired: async question => question.includes('Custom domain')
        ? 'https://acme--dev.sandbox.my.salesforce.com'
        : 'dev',
      retrieve: async options => { metadataRetrieve = options }
    })
    assert.strictEqual(metadataResult.sourceFormat, 'metadata')
    assert.strictEqual(savedProfile.alias, 'dev')
    assert.strictEqual(savedProfile.environment, 'dev')
    assert.strictEqual(metadataRetrieve.loginOpts.refreshToken, 'refresh-token')
    assert.strictEqual(metadataRetrieve.meta, 'ApexTrigger/*')
    assert.strictEqual(fs.existsSync(path.join(metadataDirectory, 'src')), true)
    assert.strictEqual(readJson(path.join(metadataDirectory, '.sfdy.json')).sourceFormat, 'metadata')

    console.log('Create command tests passed')
  } finally {
    authenticationEnvironmentNames.forEach(name => {
      if (previousAuthenticationEnvironment[name] === undefined) delete process.env[name]
      else process.env[name] = previousAuthenticationEnvironment[name]
    })
    await Promise.all(temporaryDirectories.map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})

function readJson (filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}
