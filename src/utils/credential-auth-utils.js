const credentials = require('../credentials')
const { configureAuthentication } = require('./auth-utils')
const { ask } = require('./prompt-utils')

const fromEnvironment = (options, name, envName, environment) => {
  if (!options[name] && environment[envName]) options[name] = environment[envName]
}

const selectCredential = async (profiles, { input = process.stdin, output = process.stdout } = {}) => {
  output.write('\nSaved Salesforce credentials:\n')
  profiles.forEach((profile, index) => {
    output.write(`  ${index + 1}) ${profile.alias}  ${profile.username}${profile.environment ? `  (${profile.environment})` : ''}\n`)
  })
  const answer = await ask(`Select a target [1-${profiles.length}]: `, { input, output })
  const index = Number(answer) - 1
  if (!Number.isInteger(index) || index < 0 || index >= profiles.length) throw new Error('Invalid credential selection')
  return profiles[index]
}

const resolveAuthentication = async (options, {
  credentialManager = credentials,
  interactive = !!process.stdin.isTTY,
  select = selectCredential,
  environment = process.env
} = {}) => {
  fromEnvironment(options, 'clientId', 'SFDY_CLIENT_ID', environment)
  fromEnvironment(options, 'clientSecret', 'SFDY_CLIENT_SECRET', environment)
  fromEnvironment(options, 'refreshToken', 'SFDY_REFRESH_TOKEN', environment)
  fromEnvironment(options, 'instanceUrl', 'SFDY_INSTANCE_URL', environment)
  fromEnvironment(options, 'serverUrl', 'SFDY_SERVER_URL', environment)

  const selector = options.target || (options.username && !options.password ? options.username : undefined)
  const hasCompleteAuthentication = (options.username && options.password) ||
    (options.refreshToken && options.instanceUrl) ||
    (options.clientId && options.clientSecret)
  const hasIncompleteSecret = options.password || options.refreshToken || options.instanceUrl || options.clientSecret
  if (!selector && (hasCompleteAuthentication || hasIncompleteSecret)) return configureAuthentication(options)

  let profile
  if (selector) {
    profile = await credentialManager.get(selector)
  } else {
    const profiles = await credentialManager.list()
    if (profiles.length > 0 && interactive) {
      const selected = await select(profiles)
      profile = await credentialManager.get(selected.id)
    } else if (profiles.length > 0) {
      throw new Error('No Salesforce target selected. Use --target or --username, or provide credentials through environment variables.')
    }
  }

  if (!profile) return configureAuthentication(options)
  Object.assign(options, {
    username: profile.username,
    password: profile.password,
    refreshToken: profile.refreshToken,
    instanceUrl: profile.instanceUrl,
    clientId: options.clientId || profile.clientId,
    clientSecret: options.clientSecret || profile.clientSecret,
    serverUrl: options.serverUrl || profile.serverUrl,
    sandbox: options.sandbox || profile.sandbox,
    environment: profile.environment
  })
  if (profile.environment && !process.env.environment) process.env.environment = profile.environment
  return configureAuthentication(options)
}

module.exports = { resolveAuthentication, selectCredential }
