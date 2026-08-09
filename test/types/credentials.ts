import { createCredentialManager, type CredentialMetadata } from 'sfdy/credentials'

const credentials = createCredentialManager()

async function useCredentials (): Promise<CredentialMetadata[]> {
  await credentials.save({
    alias: 'acme-dev',
    username: 'developer@example.com',
    instanceUrl: 'https://acme.my.salesforce.com',
    refreshToken: 'secret'
  })
  await credentials.get('acme-dev')
  return credentials.list()
}

void useCredentials()
