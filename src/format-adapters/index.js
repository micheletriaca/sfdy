const sfdx = require('./sfdx')

const DEFAULT_FORMAT = 'metadata'
const aliases = { mdapi: DEFAULT_FORMAT }
const adapters = { sfdx }

const normalize = format => format && format.toLowerCase()
const getFormat = (config = {}, override) => {
  const format = normalize(override) || normalize(config.sourceFormat) || DEFAULT_FORMAT
  return aliases[format] || format
}

const getAdapter = (config, override, packageMapping) => {
  const format = getFormat(config, override)
  if (format === DEFAULT_FORMAT) return null
  if (!adapters[format]) throw new Error(`Unsupported source format: ${format}`)
  return packageMapping && adapters[format].create
    ? adapters[format].create(packageMapping)
    : adapters[format]
}

module.exports = {
  DEFAULT_FORMAT,
  getAdapter,
  getFormat
}
