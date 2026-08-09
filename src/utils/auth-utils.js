const AUTH_ERROR = 'Provide exactly one authentication method: username + password, refresh token + instance URL, or client ID + client secret'
const CLIENT_CREDENTIALS_URL_ERROR = 'Client credentials authentication requires a Salesforce My Domain URL via --server-url or SFDY_SERVER_URL'

const fromEnvironment = (options, name, envName) => {
  if (!options[name] && process.env[envName]) options[name] = process.env[envName]
}

const configureAuthentication = options => {
  fromEnvironment(options, 'clientId', 'SFDY_CLIENT_ID')
  fromEnvironment(options, 'clientSecret', 'SFDY_CLIENT_SECRET')
  fromEnvironment(options, 'refreshToken', 'SFDY_REFRESH_TOKEN')
  fromEnvironment(options, 'instanceUrl', 'SFDY_INSTANCE_URL')
  fromEnvironment(options, 'serverUrl', 'SFDY_SERVER_URL')

  const hasAnyUserPassword = !!options.password
  const hasUserPassword = !!options.username && !!options.password
  const hasAnyRefreshToken = !!options.refreshToken || !!options.instanceUrl
  const hasRefreshToken = !!options.refreshToken && !!options.instanceUrl
  const hasAnyClientCredentials = !!options.clientId || !!options.clientSecret
  const hasClientCredentials = !!options.clientId && !!options.clientSecret && !hasAnyUserPassword && !hasAnyRefreshToken

  const incomplete = (hasAnyUserPassword && !hasUserPassword) ||
    (hasAnyRefreshToken && !hasRefreshToken) ||
    (hasAnyClientCredentials && !hasClientCredentials && !hasUserPassword && !hasRefreshToken)
  const modes = [hasUserPassword, hasRefreshToken, hasClientCredentials].filter(Boolean).length

  if (incomplete || modes !== 1) throw new Error(AUTH_ERROR)
  if (hasClientCredentials && !options.serverUrl) throw new Error(CLIENT_CREDENTIALS_URL_ERROR)

  options.clientCredentials = hasClientCredentials
  return options
}

const addAuthenticationOptions = program => program
  .option('--target <target>', 'Saved Salesforce credential alias')
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password + Token')
  .option('--refresh-token <refreshToken>', 'OAuth refresh token')
  .option('--instance-url <instanceUrl>', 'Salesforce instance URL for refresh-token authentication')
  .option('--client-id <clientId>', 'Connected App client ID')
  .option('--client-secret <clientSecret>', 'Connected App client secret')
  .option('--server-url <serverUrl>', 'Salesforce login or My Domain URL')
  .option('-s, --sandbox', 'Use sandbox login endpoint')

const getOauth2Options = (options, defaultClientId) => {
  const clientCredentials = options.clientCredentials || (
    !options.username && !options.password && !options.refreshToken && !options.instanceUrl && options.clientId && options.clientSecret
  )
  if (clientCredentials) {
    if (!options.serverUrl) throw new Error(CLIENT_CREDENTIALS_URL_ERROR)
    return {
      grantType: 'client_credentials',
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      loginUrl: options.serverUrl
    }
  }
  if (options.refreshToken && options.instanceUrl) {
    return {
      refreshToken: options.refreshToken,
      instanceUrl: options.instanceUrl,
      clientId: options.clientId || defaultClientId,
      clientSecret: options.clientSecret || undefined
    }
  }
}

module.exports = {
  AUTH_ERROR,
  CLIENT_CREDENTIALS_URL_ERROR,
  addAuthenticationOptions,
  configureAuthentication,
  getOauth2Options
}
