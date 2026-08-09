const fs = require('fs')
const path = require('path')
const auth = require('../auth')
const retrieve = require('../retrieve')
const { createCredentialManager } = require('../credentials')
const { resolveAuthentication } = require('../utils/credential-auth-utils')
const { DEFAULT_CLIENT_ID } = require('../utils/constants')
const { ask, askRequired, confirm } = require('../utils/prompt-utils')

const DEFAULT_API_VERSION = '65.0'
const DEFAULT_SOURCE_FORMAT = 'sfdx'
const DEFAULT_METADATA = ['ApexClass/*', 'LightningComponentBundle/*']
const METADATA_CHOICES = [
  ['ApexClass', 'Apex classes'],
  ['LightningComponentBundle', 'Lightning web components'],
  ['ApexTrigger', 'Apex triggers'],
  ['AuraDefinitionBundle', 'Aura components'],
  ['CustomObject', 'Custom objects'],
  ['PermissionSet', 'Permission sets'],
  ['Profile', 'Profiles'],
  ['Flow', 'Flows']
]

const exists = filePath => fs.existsSync(filePath)
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const normalizeFormat = value => {
  const normalized = value && value.toLowerCase()
  if (normalized === 'mdapi') return 'metadata'
  return normalized
}
const normalizeApiVersion = value => {
  if (!value || !/^\d+(\.\d+)?$/.test(String(value).trim())) {
    throw new Error(`Invalid Salesforce API version '${value}'`)
  }
  const normalized = String(value).trim()
  return normalized.includes('.') ? normalized : `${normalized}.0`
}

const packageSourceFolder = (basePath, project) => {
  const packageDirectories = project.packageDirectories || []
  const packageDirectory = packageDirectories.find(item => item.default) || packageDirectories[0]
  const packagePath = (packageDirectory && packageDirectory.path) || 'force-app'
  const conventional = path.join(packagePath, 'main', 'default')
  if (exists(path.resolve(basePath, conventional)) || !exists(path.resolve(basePath, packagePath))) return conventional
  return packagePath
}

const packageVersion = packagePath => {
  if (!exists(packagePath)) return undefined
  const match = fs.readFileSync(packagePath, 'utf8').match(/<version>([^<]+)<\/version>/)
  return match && match[1]
}

const detectProject = basePath => {
  const resolvedBasePath = path.resolve(basePath)
  const configPath = path.join(resolvedBasePath, '.sfdy.json')
  const sfdxProjectPath = path.join(resolvedBasePath, 'sfdx-project.json')
  const config = exists(configPath) ? readJson(configPath) : {}
  const sfdxProject = exists(sfdxProjectPath) ? readJson(sfdxProjectPath) : undefined
  const conventionalSfdxSource = path.join(resolvedBasePath, 'force-app', 'main', 'default')
  const conventionalMetadataSource = path.join(resolvedBasePath, 'src')
  const sourceFormat = normalizeFormat(config.sourceFormat) ||
    (sfdxProject || exists(conventionalSfdxSource) ? 'sfdx' : undefined)
  const sourceFolder = config.sourceFolder || (sourceFormat
    ? sourceFormat === 'sfdx'
      ? packageSourceFolder(resolvedBasePath, sfdxProject || {})
      : 'src'
    : undefined)
  const metadataPackagePath = path.join(resolvedBasePath, sourceFolder || 'src', 'package.xml')
  const entries = exists(resolvedBasePath)
    ? fs.readdirSync(resolvedBasePath).filter(entry => !['.git', '.DS_Store'].includes(entry))
    : []
  const inferredMetadata = !sourceFormat && (
    exists(metadataPackagePath) ||
    exists(path.join(resolvedBasePath, 'src', 'package.xml')) ||
    exists(conventionalMetadataSource)
  )

  return {
    basePath: resolvedBasePath,
    config,
    configPath,
    empty: entries.length === 0,
    existing: entries.length > 0,
    sourceFormat: inferredMetadata ? 'metadata' : sourceFormat,
    sourceFolder: inferredMetadata ? 'src' : sourceFolder,
    apiVersion: config.apiVersion || (sfdxProject && sfdxProject.sourceApiVersion) || packageVersion(metadataPackagePath),
    sfdxProject,
    sfdxProjectPath
  }
}

const parseMetadataSelection = value => {
  if (Array.isArray(value)) return value
  if (!value || !String(value).trim()) return [...DEFAULT_METADATA]
  const tokens = String(value).split(',').map(token => token.trim()).filter(Boolean)
  return [...new Set(tokens.map(token => {
    if (/^\d+$/.test(token)) {
      const choice = METADATA_CHOICES[Number(token) - 1]
      if (!choice) throw new Error(`Unknown metadata choice '${token}'`)
      return `${choice[0]}/*`
    }
    return token.includes('/') ? token : `${token}/*`
  }))]
}

const chooseFormat = async ({ prompt = ask, input, output }) => {
  output.write('Project format:\n  1) Salesforce DX\n  2) Metadata API\n')
  const answer = (await prompt('Select a format [1]: ', { input, output })).trim().toLowerCase()
  if (!answer || answer === '1' || answer === 'sfdx') return 'sfdx'
  if (answer === '2' || answer === 'metadata' || answer === 'mdapi') return 'metadata'
  throw new Error(`Unsupported source format '${answer}'`)
}

const chooseMetadata = async ({ prompt = ask, input, output }) => {
  output.write('\nMetadata to retrieve:\n')
  METADATA_CHOICES.forEach(([type, label], index) => {
    const selected = DEFAULT_METADATA.includes(`${type}/*`) ? ' (default)' : ''
    output.write(`  ${index + 1}) ${label}${selected}\n`)
  })
  const answer = await prompt('Select comma-separated numbers or metadata types [1,2]: ', { input, output })
  return parseMetadataSelection(answer)
}

const normalizeLoginHost = value => {
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The Salesforce login domain must not contain a path, query or fragment')
  }
  return url.host
}

const chooseLoginHost = async ({ options, prompt = ask, requiredPrompt = askRequired, input, output }) => {
  if (options.serverUrl) return normalizeLoginHost(options.serverUrl)
  if (options.sandbox) return 'test.salesforce.com'

  output.write('\nSalesforce login:\n  1) Production\n  2) Sandbox\n  3) Custom domain\n')
  const answer = (await prompt('Select a login type [1]: ', { input, output })).trim().toLowerCase()
  if (!answer || answer === '1' || answer === 'production' || answer === 'prod') return 'login.salesforce.com'
  if (answer === '2' || answer === 'sandbox' || answer === 'test') return 'test.salesforce.com'
  if (answer === '3' || answer === 'custom') {
    return normalizeLoginHost(await requiredPrompt('Custom domain: ', { input, output }))
  }
  throw new Error(`Unknown Salesforce login type '${answer}'`)
}

const initializeProject = async ({ basePath, sourceFormat, sourceFolder, apiVersion, detected }) => {
  await fs.promises.mkdir(basePath, { recursive: true })
  let sfdxProject = detected.sfdxProject
  if (sourceFormat === 'sfdx' && !sfdxProject) {
    const normalizedSourceFolder = sourceFolder.replace(/\\/g, '/')
    const packageDirectory = normalizedSourceFolder.endsWith('/main/default')
      ? normalizedSourceFolder.slice(0, -'/main/default'.length)
      : normalizedSourceFolder
    sfdxProject = {
      packageDirectories: [{ path: packageDirectory, default: true }],
      namespace: '',
      sourceApiVersion: apiVersion
    }
    await fs.promises.writeFile(detected.sfdxProjectPath, `${JSON.stringify(sfdxProject, null, 2)}\n`)
  }

  const config = {
    ...detected.config,
    sourceFormat,
    apiVersion
  }
  if (sourceFormat === 'metadata' && sourceFolder !== 'src') config.sourceFolder = sourceFolder
  await fs.promises.writeFile(detected.configPath, `${JSON.stringify(config, null, 2)}\n`)
  await fs.promises.mkdir(path.resolve(basePath, sourceFolder), { recursive: true })
  return config
}

const hasExplicitAuthentication = (options, { includeEnvironment = true } = {}) => !!(
  options.target || options.username || options.password || options.refreshToken || options.instanceUrl ||
  (includeEnvironment && (process.env.SFDY_REFRESH_TOKEN || process.env.SFDY_INSTANCE_URL)) ||
  ((options.clientId || (includeEnvironment && process.env.SFDY_CLIENT_ID)) &&
    (options.clientSecret || (includeEnvironment && process.env.SFDY_CLIENT_SECRET)) &&
    (options.serverUrl || (includeEnvironment && process.env.SFDY_SERVER_URL)))
)

const login = async ({
  options,
  interactive,
  credentialManager,
  authenticate = auth,
  prompt = ask,
  requiredPrompt = askRequired,
  confirmPrompt = confirm,
  input,
  output
}) => {
  const profiles = await credentialManager.list()
  if (profiles.length || hasExplicitAuthentication(options, { includeEnvironment: !interactive })) {
    return resolveAuthentication({ ...options }, {
      credentialManager,
      interactive,
      environment: interactive ? {} : process.env,
      select: async available => {
        output.write('\nSaved Salesforce credentials:\n')
        available.forEach((profile, index) => output.write(`  ${index + 1}) ${profile.alias}  ${profile.username}\n`))
        const answer = await prompt(`Select a target [1-${available.length}]: `, { input, output })
        const selected = available[Number(answer) - 1]
        if (!selected) throw new Error('Invalid credential selection')
        return selected
      }
    })
  }
  if (!interactive) {
    throw new Error('Authentication is required. Run sfdy create interactively, use --target, or provide credentials through environment variables.')
  }

  const loginHost = await chooseLoginHost({ options, prompt, requiredPrompt, input, output })
  output.write(`\nOpening Salesforce login on ${loginHost}...\n`)
  const clientId = options.clientId || DEFAULT_CLIENT_ID
  const clientSecret = options.clientSecret
  const result = await authenticate(loginHost, clientId, clientSecret, options.callbackPort || 3000)
  if (!result.oauth2.refresh_token) {
    throw new Error('Salesforce did not return a refresh token. Check the Connected App OAuth scopes and refresh-token policy.')
  }
  const loginOptions = {
    username: result.userInfo.username,
    instanceUrl: result.oauth2.instance_url,
    refreshToken: result.oauth2.refresh_token,
    clientId,
    clientSecret,
    environment: options.environment
  }
  const shouldSave = options.save || (options.save === undefined && await confirmPrompt('Save this login in the project vault?', { input, output }))
  if (shouldSave) {
    const alias = options.alias || await requiredPrompt('Credential alias: ', { input, output })
    const saved = await credentialManager.save({
      ...loginOptions,
      alias,
      environment: options.environment || alias
    })
    loginOptions.environment = saved.environment
    loginOptions.target = saved.alias
    output.write(`Saved credential '${saved.alias}'.\n`)
  }
  return loginOptions
}

const createProject = async (options = {}, dependencies = {}) => {
  const basePath = path.resolve(options.directory || process.cwd())
  const input = dependencies.input || process.stdin
  const output = dependencies.output || process.stdout
  const interactive = dependencies.interactive === undefined ? !!input.isTTY : dependencies.interactive
  const prompt = dependencies.ask || ask
  const detected = detectProject(basePath)

  let sourceFormat = normalizeFormat(options.sourceFormat) || detected.sourceFormat
  if (!sourceFormat) {
    sourceFormat = interactive
      ? await chooseFormat({ prompt, input, output })
      : DEFAULT_SOURCE_FORMAT
  }
  if (!['metadata', 'sfdx'].includes(sourceFormat)) throw new Error(`Unsupported source format '${sourceFormat}'`)
  if (detected.sourceFormat) output.write(`Detected ${detected.sourceFormat === 'sfdx' ? 'Salesforce DX' : 'Metadata API'} project.\n`)

  const sourceFolder = options.folder ||
    (sourceFormat === detected.sourceFormat ? detected.sourceFolder : undefined) ||
    (sourceFormat === 'sfdx' ? 'force-app/main/default' : 'src')
  const apiVersion = normalizeApiVersion(options.apiVersion || detected.apiVersion || DEFAULT_API_VERSION)
  const metadata = options.metadata
    ? parseMetadataSelection(options.metadata)
    : interactive
      ? await chooseMetadata({ prompt, input, output })
      : [...DEFAULT_METADATA]

  const config = await initializeProject({ basePath, sourceFormat, sourceFolder, apiVersion, detected })
  output.write(`Configured ${sourceFormat} project in ${basePath}.\n`)

  const credentialManager = dependencies.credentialManager || createCredentialManager({ basePath })
  const loginOptions = await login({
    options,
    interactive,
    credentialManager,
    authenticate: dependencies.authenticate,
    prompt,
    requiredPrompt: dependencies.askRequired,
    confirmPrompt: dependencies.confirm,
    input,
    output
  })

  if (loginOptions.environment && !process.env.environment) process.env.environment = loginOptions.environment
  if (options.retrieve !== false) {
    await (dependencies.retrieve || retrieve)({
      basePath,
      config,
      loginOpts: loginOptions,
      meta: metadata.join(','),
      srcFolder: sourceFolder,
      sourceFormat
    })
  }
  output.write(options.retrieve === false
    ? '\nProject ready. Initial retrieve skipped.\n'
    : `\nProject ready. Retrieved ${metadata.join(', ')}.\n`)
  return { basePath, config, loginOptions, metadata, sourceFolder, sourceFormat }
}

module.exports = {
  DEFAULT_API_VERSION,
  DEFAULT_METADATA,
  METADATA_CHOICES,
  chooseFormat,
  chooseLoginHost,
  chooseMetadata,
  createProject,
  detectProject,
  initializeProject,
  normalizeLoginHost,
  parseMetadataSelection
}
