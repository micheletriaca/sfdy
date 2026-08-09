export interface CredentialProfile {
  id?: string
  alias?: string
  username: string
  environment?: string
  instanceUrl?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  serverUrl?: string
  password?: string
  sessionId?: string
  sandbox?: boolean
  [key: string]: unknown
}

export type CredentialMetadata = Omit<CredentialProfile, 'refreshToken' | 'clientSecret' | 'password' | 'sessionId'> & {
  id: string
  alias: string
}

export class CredentialStoreUnavailableError extends Error {}
export class CredentialSelectionError extends Error {}

export interface CredentialManager {
  readonly vaultPath: string
  list(): Promise<CredentialMetadata[]>
  get(selector: string): Promise<CredentialProfile & { id: string, alias: string }>
  resolveProfile(selector: string): Promise<CredentialMetadata>
  save(profile: CredentialProfile): Promise<CredentialProfile & { id: string, alias: string }>
  remove(selector: string): Promise<boolean>
}

export function getVaultPath(options?: { basePath?: string }): string

export function createCredentialManager(options?: {
  basePath?: string
  vaultPath?: string
  backend?: {
    get(account: string): Promise<string | null | undefined>
    set(account: string, value: string): Promise<unknown>
    delete(account: string): Promise<unknown>
  }
  updateGitignore?: boolean
}): CredentialManager

export function list(): Promise<CredentialMetadata[]>
export function get(selector: string): Promise<CredentialProfile & { id: string, alias: string }>
export function resolveProfile(selector: string): Promise<CredentialMetadata>
export function save(profile: CredentialProfile): Promise<CredentialProfile & { id: string, alias: string }>
export function remove(selector: string): Promise<boolean>
