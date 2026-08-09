const path = require('path')
const chalk = require('chalk')
const nativeRequire = require('../utils/native-require')
const logger = require('../services/log-service')
const { isV2Extension } = require('./index')
const LegacyExtension = require('./legacy-adapter')

const unwrapDefault = loaded => loaded && loaded.default &&
  (loaded.__esModule || Object.keys(loaded).length === 1)
  ? loaded.default
  : loaded

const loadEntry = (entry, basePath) => {
  const descriptor = entry && typeof entry === 'object' && typeof entry.path === 'string'
    ? entry
    : undefined
  const source = descriptor ? descriptor.path : entry
  if (typeof source !== 'string') return { source: undefined, extension: entry, overrides: {} }
  const absolutePath = path.resolve(basePath, source)
  return {
    source,
    extension: unwrapDefault(nativeRequire(absolutePath)),
    overrides: descriptor
      ? { stage: descriptor.stage, formats: descriptor.formats }
      : {}
  }
}

const prepareExtensions = ({ entries, basePath, packageJson, legacyHook }) => {
  const prepared = []
  const legacySources = []
  entries.map(entry => loadEntry(entry, basePath)).forEach(loaded => {
    if (isV2Extension(loaded.extension)) {
      const extension = { ...loaded.extension }
      if (loaded.overrides.stage !== undefined) extension.stage = loaded.overrides.stage
      if (loaded.overrides.formats !== undefined) extension.formats = loaded.overrides.formats
      if (!['metadata', 'project'].includes(extension.stage || 'project')) {
        throw new TypeError(`Invalid stage for extension ${loaded.source || extension.name}`)
      }
      if (extension.formats && (!Array.isArray(extension.formats) ||
        extension.formats.some(format => !['metadata', 'sfdx'].includes(format)))) {
        throw new TypeError(`Invalid formats for extension ${loaded.source || extension.name}`)
      }
      prepared.push(extension)
      return
    }
    if (loaded.overrides.stage !== undefined || loaded.overrides.formats !== undefined) {
      throw new TypeError(`Stage and format overrides require Plugin API v2: ${loaded.source}`)
    }
    const legacyFunction = legacyHook ? loaded.extension && loaded.extension[legacyHook] : loaded.extension
    if (typeof legacyFunction !== 'function') {
      throw new TypeError(`Invalid legacy extension ${loaded.source || '<inline>'}`)
    }
    prepared.push(new LegacyExtension({
      extension: legacyFunction,
      source: loaded.source,
      packageJson
    }))
    if (loaded.source) legacySources.push(loaded)
  })
  return { extensions: prepared, legacy: legacySources }
}

const warnLegacy = (legacy, kind) => {
  const sources = [...new Set(legacy.map(item => item.source).filter(Boolean))]
  if (!sources.length) return
  logger.log(chalk.yellow(
    `[deprecated] ${kind} API v1 detected:\n${sources.map(source => `  ${source}`).join('\n')}\n` +
    'The v1 API now runs in the project format; format-dependent extensions may need migration. ' +
    'Plugin API v1 will be removed in sfdy 3.'
  ))
}

module.exports = {
  prepareExtensions,
  warnLegacy,
  loadEntry
}
