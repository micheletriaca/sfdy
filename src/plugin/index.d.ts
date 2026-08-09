/// <reference types="node" />

export type Awaitable<T> = T | Promise<T>
export type Direction = 'retrieve' | 'deploy'
export type ProjectFormat = 'metadata' | 'sfdx'
export type ExtensionStage = 'metadata' | 'project'
export type Glob = string | readonly string[]
export type XmlObject = Record<string, any>
export type PluginConfig = Record<string, any>
export type FileOrigin = 'disk' | 'incoming' | 'generated'

export interface ProjectFile {
  readonly path: string
  readonly origin: FileOrigin
  readBytes(): Promise<Buffer>
  readText(encoding?: BufferEncoding): Promise<string>
  readXml<T = XmlObject>(): Promise<T>
}

export interface MutableFile extends ProjectFile {
  writeBytes(contents: Buffer | Uint8Array | string): this
  writeText(contents: string, encoding?: BufferEncoding): this
  writeXml<T extends XmlObject>(document: T): Promise<this>
  exclude(): this
  delete(): this
}

export interface ProjectView {
  match(patterns: Glob): ProjectFile[]
  get(path: string): ProjectFile | undefined
  has(path: string): boolean
}

export interface CreateFileInput {
  path: string
  contents?: Buffer | Uint8Array | string
}

export interface FileEntry {
  fileName: string
  data: Buffer
}

export interface FileSet {
  match(patterns: Glob): MutableFile[]
  get(path: string): MutableFile | undefined
  has(path: string): boolean
  include(file: ProjectFile): MutableFile
  create(input: CreateFileInput): MutableFile
  exclude(patterns: Glob): void
  excludeWhere(predicate: (file: MutableFile) => boolean): void
  delete(patterns: Glob): void
  entries(): FileEntry[]
}

export interface OutputWorkspace {
  delete(patterns: Glob): void
}

export interface FileTreeInput {
  diskEntries?: Array<FileEntry | { path: string, contents: Buffer | Uint8Array | string }>
  files?: Array<FileEntry | { path: string, contents: Buffer | Uint8Array | string, origin?: FileOrigin }>
  origin?: FileOrigin
}

export interface FileTreeDiff {
  created: string[]
  modified: string[]
  excluded: string[]
  deleted: string[]
}

export class FileTree {
  constructor(input?: FileTreeInput)
  readonly files: FileSet
  readonly project: ProjectView
  readonly disk: ProjectView
  readonly output: OutputWorkspace
  entries(): FileEntry[]
  deletedPaths(): string[]
  markDeleted(paths: string | readonly string[]): void
  diff(): FileTreeDiff
}

export class MetadataCollection implements MetadataInventory {
  constructor(addresses?: MetadataAddress[])
  match(patterns: Glob): MetadataAddress[]
  has(address: MetadataAddress): boolean
  values(): MetadataAddress[]
}

export class MetadataSelection extends MetadataCollection implements Selection {
  include(addresses: MetadataAddress | readonly MetadataAddress[]): void
  exclude(addresses: MetadataAddress | readonly MetadataAddress[]): void
  require(addresses: MetadataAddress | readonly MetadataAddress[]): void
  toPackage(basePackage?: Record<string, unknown>): Record<string, unknown>
  toOutputPackage(basePackage?: Record<string, unknown>): Record<string, unknown>
}

export interface FileSelectionView {
  match(patterns: Glob): string[]
  has(path: string): boolean
  include(paths: string | readonly string[]): void
  exclude(paths: string | readonly string[]): void
  replace(paths: readonly string[]): void
  values(): string[]
}

export class FileSelection implements FileSelectionView {
  constructor(paths?: string[])
  match(patterns: Glob): string[]
  has(path: string): boolean
  include(paths: string | readonly string[]): void
  exclude(paths: string | readonly string[]): void
  replace(paths: readonly string[]): void
  values(): string[]
}

export interface MetadataAddress {
  type: string
  fullName: string
}

export interface MetadataInventory {
  match(patterns: Glob): MetadataAddress[]
  has(address: MetadataAddress): boolean
}

export interface Selection {
  match(patterns: Glob): MetadataAddress[]
  has(address: MetadataAddress): boolean
  include(addresses: MetadataAddress | readonly MetadataAddress[]): void
  exclude(addresses: MetadataAddress | readonly MetadataAddress[]): void
  require(addresses: MetadataAddress | readonly MetadataAddress[]): void
}

export interface SalesforceClient {
  readonly username?: string
  readonly apiVersion?: string
  readonly instanceUrl?: string
  query<TRecord = Record<string, unknown>>(query: string, useTooling?: boolean): Promise<TRecord[]>
  rest<T = unknown>(path: string): Promise<T>
  metadata<T = unknown>(method: string, args: unknown, options?: {
    wsdl?: 'metadata' | 'partner'
    rawBody?: boolean
    rawResponse?: boolean
  }): Promise<T>
  describeMetadata<T = unknown>(): Promise<T>
  listMetadata<T = unknown>(types: string[]): Promise<T>
  publishCommunity<T = unknown>(communityId: string): Promise<T>
}

export interface Target {
  environment?: string
  username?: string
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface BaseContext<TConfig = PluginConfig> {
  direction: Direction
  format: ProjectFormat
  target: Target
  salesforce: SalesforceClient
  config: TConfig
  log: PluginLogger
}

export interface PlanContext<TConfig = PluginConfig> extends Omit<BaseContext<TConfig>, 'direction'> {
  direction: 'retrieve'
  selection: Selection
  inventory: MetadataInventory
}

export interface RunContext<TConfig = PluginConfig> extends BaseContext<TConfig> {
  files: FileSet
  project: ProjectView
  disk: ProjectView
  output: OutputWorkspace
}

export interface RetrieveContext<TConfig = PluginConfig> extends Omit<RunContext<TConfig>, 'direction'> {
  direction: 'retrieve'
}

export interface DeployContext<TConfig = PluginConfig> extends Omit<RunContext<TConfig>, 'direction'> {
  direction: 'deploy'
  checkOnly: boolean
  destructive: boolean
}

export interface EnableContext<TConfig = PluginConfig> extends BaseContext<TConfig> {
  selection?: Selection | FileSelectionView
  inventory?: MetadataInventory
  files?: FileSet
  project?: ProjectView
  disk?: ProjectView
  output?: OutputWorkspace
  checkOnly?: boolean
  destructive?: boolean
}

export interface Plugin<TConfig = PluginConfig> {
  readonly apiVersion: 2
  name: string
  stage?: ExtensionStage
  formats?: readonly ProjectFormat[]
  enabled?(context: EnableContext<TConfig>): Awaitable<boolean>
  plan?(context: PlanContext<TConfig>): Awaitable<void>
  run?(context: RunContext<TConfig>): Awaitable<void>
  onRetrieve?(context: RetrieveContext<TConfig>): Awaitable<void>
  onDeploy?(context: DeployContext<TConfig>): Awaitable<void>
}

export type PluginDefinition<TConfig = PluginConfig> = Omit<Plugin<TConfig>, 'apiVersion'>

export interface SelectionResolutionContext<TConfig = PluginConfig> extends BaseContext<TConfig> {
  selection: FileSelectionView
  project: ProjectView
}

export interface Renderer<TConfig = PluginConfig> {
  readonly apiVersion: 2
  name: string
  formats?: readonly ProjectFormat[]
  enabled?(context: EnableContext<TConfig>): Awaitable<boolean>
  resolveSelection?(context: SelectionResolutionContext<TConfig>): Awaitable<void>
  onRetrieve?(context: RetrieveContext<TConfig>): Awaitable<void>
  onDeploy?(context: DeployContext<TConfig>): Awaitable<void>
}

export type RendererDefinition<TConfig = PluginConfig> = Omit<Renderer<TConfig>, 'apiVersion'>

export const API_VERSION: 2
export function definePlugin<TConfig = PluginConfig>(plugin: PluginDefinition<TConfig>): Plugin<TConfig>
export function defineRenderer<TConfig = PluginConfig>(renderer: RendererDefinition<TConfig>): Renderer<TConfig>
export function isV2Extension(extension: unknown): extension is Plugin | Renderer
