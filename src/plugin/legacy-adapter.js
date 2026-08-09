const multimatch = require('multimatch')
const logger = require('../services/log-service')
const { parseXml, buildXml, parseXmlNoArray } = require('../utils/xml-utils')

const asArray = value => Array.isArray(value) ? value : [value]
const addressKey = address => `${address.type}/${address.fullName}`
const parseAddress = value => {
  const separator = value.indexOf('/')
  return { type: value.slice(0, separator), fullName: value.slice(separator + 1) }
}

class LegacyExtension {
  constructor ({ extension, source, packageJson = {} }) {
    this.name = source || extension.name || 'legacy-plugin'
    this.stage = 'project'
    this._extension = extension
    this._source = source
    this._packageJson = packageJson
    this._legacyPackage = structuredClone(packageJson)
    this._initialized = false
    this._transformations = []
    this._filters = []
    this._dependencies = []
    this._remappers = []
  }

  async _initialize (context) {
    if (this._initialized) return
    this._initialized = true
    const helpers = {
      xmlTransformer: (pattern, callback) => this._transformations.push({ type: 'xml', pattern, callback }),
      modifyRawContent: (pattern, callback) => this._transformations.push({ type: 'raw', pattern, callback }),
      filterMetadata: predicate => this._filters.push(predicate),
      requireMetadata: (pattern, callback) => this._dependencies.push({ pattern, callback }),
      addRemapper: (regexp, callback) => this._remappers.push({ regexp, callback })
    }
    await this._extension({
      sfdcConnector: context.salesforce,
      environment: context.target.environment,
      username: context.target.username,
      log: logger.log,
      pkg: this._legacyPackage,
      config: context.config
    }, helpers, { parseXml, buildXml, parseXmlNoArray })
  }

  setPackage (packageJson) {
    Object.keys(this._legacyPackage).forEach(key => delete this._legacyPackage[key])
    Object.assign(this._legacyPackage, structuredClone(packageJson))
    this._packageJson = packageJson
  }

  async plan (context) {
    await this._initialize(context)
    const selectedKeys = context.selection.values().map(addressKey)
    for (const dependency of this._dependencies) {
      if (!multimatch(selectedKeys, asArray(dependency.pattern)).length) continue
      const includeExisting = values => asArray(values).forEach(value => {
        const pattern = value.includes('/') ? value : `${value}/*`
        context.selection.require(context.inventory.match(pattern))
      })
      const includeRequired = values => asArray(values).forEach(value => {
        context.selection.require(value.includes('/') ? parseAddress(value) : { type: value, fullName: '*' })
      })
      await dependency.callback({
        filterPackage: includeExisting,
        patchPackage: includeRequired,
        requirePackage: includeRequired
      })
    }
  }

  async run (context) {
    await this._initialize(context)
    const cleanPatterns = []
    const requireFiles = async patterns => {
      const required = context.project.match(patterns)
      for (const file of required) {
        if (!context.files.has(file.path)) context.files.include(file)
      }
      return Promise.all(required.map(async file => ({
        fileName: file.path,
        data: await context.files.get(file.path).readBytes()
      })))
    }
    const addFiles = value => asArray(value).forEach(entry => {
      const existing = context.files.get(entry.fileName)
      if (existing) existing.writeBytes(entry.data)
      else context.files.create({ path: entry.fileName, contents: entry.data })
    })
    const cleanFiles = (...patterns) => cleanPatterns.push(...patterns.flat())

    for (const transformation of this._transformations) {
      const matchingFiles = context.files.match(transformation.pattern)
      for (const file of matchingFiles) {
        try {
          if (transformation.type === 'xml') {
            const xml = await file.readXml()
            await transformation.callback(file.path, xml, requireFiles, addFiles, cleanFiles)
            await file.writeXml(xml)
          } else {
            const legacyFile = { fileName: file.path, data: await file.readBytes() }
            await transformation.callback(file.path, legacyFile, requireFiles, addFiles, cleanFiles)
            file.writeBytes(legacyFile.data)
          }
        } catch (error) {
          error.message = `Legacy extension ${this.name} failed for ${file.path}: ${error.message}`
          throw error
        }
      }
    }

    if (cleanPatterns.length) context.output.delete(cleanPatterns)
    for (const file of context.files.match('**/*')) {
      const data = await file.readBytes()
      if (this._filters.some(predicate => !predicate(file.path, data))) file.exclude()
    }
  }

  remapPaths (paths) {
    return paths.map(filePath => this._remappers.reduce((result, remapper) =>
      remapper.regexp.test(result) ? remapper.callback(result, remapper.regexp) : result, filePath))
  }

  async resolveSelection (context) {
    await this._initialize(context)
    context.selection.replace(this.remapPaths(context.selection.values()))
  }
}

module.exports = LegacyExtension
