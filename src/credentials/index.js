const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SERVICE = 'sfdy'
const VAULT_VERSION = 1
const ALGORITHM = 'aes-256-gcm'
const AAD_PREFIX = 'sfdy:project-credential-vault:v1:'
const SECRET_FIELDS = ['refreshToken', 'clientSecret', 'password', 'sessionId']

class CredentialStoreUnavailableError extends Error {
  constructor (message, options) {
    super(message, options)
    this.name = 'CredentialStoreUnavailableError'
  }
}

class CredentialSelectionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'CredentialSelectionError'
  }
}

const getVaultPath = ({ basePath = process.cwd() } = {}) => path.resolve(basePath, '.sfdy', 'credentials.vault')
const keyAccount = vaultId => `credential-vault-key:${vaultId}`

const createKeyringBackend = () => {
  let AsyncEntry
  try {
    AsyncEntry = require('@napi-rs/keyring').AsyncEntry
  } catch (cause) {
    throw new CredentialStoreUnavailableError(
      'The system credential store is unavailable. Use environment variables or install the optional @napi-rs/keyring package.',
      { cause }
    )
  }

  const entry = account => new AsyncEntry(SERVICE, account)
  return {
    get: account => entry(account).getPassword(),
    set: (account, value) => entry(account).setPassword(value),
    delete: account => entry(account).deleteCredential()
  }
}

const emptyState = () => ({
  id: crypto.randomUUID(),
  vault: { version: VAULT_VERSION, profiles: [] }
})

const encrypt = ({ id, vault }, key) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(`${AAD_PREFIX}${id}`))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(vault), 'utf8'), cipher.final()])
  return JSON.stringify({
    version: VAULT_VERSION,
    id,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  }, null, 2)
}

const decrypt = (payload, key) => {
  const envelope = JSON.parse(payload)
  if (envelope.version !== VAULT_VERSION || envelope.algorithm !== ALGORITHM || !envelope.id) {
    throw new Error(`Unsupported credential vault format version '${envelope.version}'`)
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from(`${AAD_PREFIX}${envelope.id}`))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ])
  const vault = JSON.parse(decrypted.toString('utf8'))
  return {
    id: envelope.id,
    vault: {
      version: VAULT_VERSION,
      profiles: Array.isArray(vault.profiles) ? vault.profiles : []
    }
  }
}

const writeAtomic = async (vaultPath, contents) => {
  const directory = path.dirname(vaultPath)
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = `${vaultPath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(temporaryPath, contents, { mode: 0o600 })
    await fs.promises.rename(temporaryPath, vaultPath)
    await fs.promises.chmod(vaultPath, 0o600)
  } finally {
    await fs.promises.unlink(temporaryPath).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

const ensureIgnored = async basePath => {
  const gitignorePath = path.resolve(basePath, '.gitignore')
  let gitignore = ''
  try {
    gitignore = await fs.promises.readFile(gitignorePath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const entries = gitignore.split(/\r?\n/).map(line => line.trim())
  if (entries.includes('.sfdy/') || entries.includes('/.sfdy/')) return
  const separator = gitignore && !gitignore.endsWith('\n') ? '\n' : ''
  await fs.promises.appendFile(gitignorePath, `${separator}/.sfdy/\n`)
}

const normalize = value => value && value.toLowerCase()
const findProfiles = (profiles, selector) => {
  const normalized = normalize(selector)
  return profiles.filter(profile => [profile.id, profile.alias, profile.username]
    .some(value => normalize(value) === normalized))
}
const clone = value => JSON.parse(JSON.stringify(value))
const withoutSecrets = profile => Object.fromEntries(
  Object.entries(profile).filter(([field]) => !SECRET_FIELDS.includes(field))
)
const selectProfile = (profiles, selector) => {
  const matches = findProfiles(profiles, selector)
  if (matches.length === 0) throw new CredentialSelectionError(`No saved Salesforce credential matches '${selector}'`)
  if (matches.length > 1) {
    throw new CredentialSelectionError(`More than one saved Salesforce credential matches '${selector}'. Use its alias instead.`)
  }
  return matches[0]
}

const createCredentialManager = ({
  basePath = process.cwd(),
  vaultPath = getVaultPath({ basePath }),
  backend,
  updateGitignore = true
} = {}) => {
  let secureBackend = backend
  const getBackend = () => {
    if (!secureBackend) secureBackend = createKeyringBackend()
    return secureBackend
  }

  const readKey = async (vaultId, { create = false } = {}) => {
    const account = keyAccount(vaultId)
    let encoded
    try {
      encoded = await getBackend().get(account)
      if (!encoded && create) {
        encoded = crypto.randomBytes(32).toString('base64')
        await getBackend().set(account, encoded)
      }
    } catch (cause) {
      throw new CredentialStoreUnavailableError('Unable to access the sfdy project vault key', { cause })
    }
    if (!encoded) throw new CredentialStoreUnavailableError('The key for this sfdy project vault is missing from the system keychain')
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32) throw new CredentialStoreUnavailableError('The sfdy project vault key is invalid')
    return key
  }

  const readState = async () => {
    let payload
    try {
      payload = await fs.promises.readFile(vaultPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState()
      throw error
    }
    let envelope
    try {
      envelope = JSON.parse(payload)
      return decrypt(payload, await readKey(envelope.id))
    } catch (cause) {
      if (cause instanceof CredentialStoreUnavailableError) throw cause
      throw new CredentialStoreUnavailableError('Unable to decrypt this project credential vault', { cause })
    }
  }

  const writeState = async state => {
    await writeAtomic(vaultPath, encrypt(state, await readKey(state.id, { create: true })))
    if (updateGitignore) await ensureIgnored(basePath)
  }

  const list = async () => clone((await readState()).vault.profiles.map(withoutSecrets))

  const resolveProfile = async selector => clone(withoutSecrets(selectProfile((await readState()).vault.profiles, selector)))
  const get = async selector => clone(selectProfile((await readState()).vault.profiles, selector))

  const save = async profile => {
    if (!profile || !profile.username) throw new Error('A Salesforce username is required')
    if (!(profile.refreshToken || profile.clientSecret || profile.password || profile.sessionId)) {
      throw new Error('No credential secret was provided')
    }
    const state = await readState()
    const alias = profile.alias || profile.username
    const aliasMatch = state.vault.profiles.find(item => normalize(item.alias) === normalize(alias))
    const idMatch = profile.id && state.vault.profiles.find(item => item.id === profile.id)
    if (aliasMatch && profile.id && aliasMatch.id !== profile.id) {
      throw new CredentialSelectionError(`Credential alias '${alias}' is already in use`)
    }

    const existing = idMatch || aliasMatch
    const stored = { ...existing, ...profile, id: existing ? existing.id : (profile.id || crypto.randomUUID()), alias }
    if (!stored.environment) stored.environment = alias
    const index = state.vault.profiles.findIndex(item => item.id === stored.id)
    if (index === -1) state.vault.profiles.push(stored)
    else state.vault.profiles[index] = stored
    await writeState(state)
    return clone(stored)
  }

  const remove = async selector => {
    const state = await readState()
    const matches = findProfiles(state.vault.profiles, selector)
    if (matches.length === 0) return false
    const selected = selectProfile(state.vault.profiles, selector)
    state.vault.profiles = state.vault.profiles.filter(item => item.id !== selected.id)
    await writeState(state)
    return true
  }

  return { vaultPath, get, list, remove, resolveProfile, save }
}

const credentials = createCredentialManager()

module.exports = {
  CredentialSelectionError,
  CredentialStoreUnavailableError,
  createCredentialManager,
  getVaultPath,
  get: credentials.get,
  list: credentials.list,
  remove: credentials.remove,
  resolveProfile: credentials.resolveProfile,
  save: credentials.save
}
