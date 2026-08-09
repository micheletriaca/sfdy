const multimatch = require('multimatch')

const keyOf = address => `${address.type}/${address.fullName}`
const fromKey = key => {
  const separator = key.indexOf('/')
  return { type: key.slice(0, separator), fullName: key.slice(separator + 1) }
}
const asArray = value => Array.isArray(value) ? value : [value]
const packageFromKeys = (keys, basePackage) => {
  const byType = new Map()
  ;[...keys].map(fromKey).forEach(({ type, fullName }) => {
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(fullName)
  })
  return {
    ...basePackage,
    types: [...byType.entries()].map(([name, members]) => ({ name: [name], members }))
  }
}

class MetadataCollection {
  constructor (addresses = []) {
    this._keys = new Set(addresses.map(keyOf))
  }

  match (patterns) {
    return multimatch([...this._keys], asArray(patterns)).map(fromKey)
  }

  has (address) {
    return this._keys.has(keyOf(address))
  }

  values () {
    return [...this._keys].map(fromKey)
  }
}

class MetadataSelection extends MetadataCollection {
  constructor (addresses = []) {
    super(addresses)
    this._required = new Set()
  }

  include (addresses) {
    asArray(addresses).filter(Boolean).forEach(address => this._keys.add(keyOf(address)))
  }

  exclude (addresses) {
    asArray(addresses).filter(Boolean).forEach(address => this._keys.delete(keyOf(address)))
  }

  require (addresses) {
    asArray(addresses).filter(Boolean).forEach(address => this._required.add(keyOf(address)))
  }

  toPackage (basePackage = {}) {
    return packageFromKeys(new Set([...this._keys, ...this._required]), basePackage)
  }

  toOutputPackage (basePackage = {}) {
    return packageFromKeys(this._keys, basePackage)
  }
}

class FileSelection {
  constructor (paths = []) {
    this._paths = [...new Set(paths)]
  }

  match (patterns) {
    return multimatch(this._paths, asArray(patterns))
  }

  has (filePath) {
    return this._paths.includes(filePath)
  }

  include (paths) {
    this._paths = [...new Set([...this._paths, ...asArray(paths)])]
  }

  exclude (paths) {
    const excluded = new Set(asArray(paths))
    this._paths = this._paths.filter(filePath => !excluded.has(filePath))
  }

  replace (paths) {
    this._paths = [...new Set(paths)]
  }

  values () {
    return [...this._paths]
  }
}

const addressesFromPackage = pkg => (pkg.types || []).flatMap(type =>
  (type.members || []).map(fullName => ({ type: type.name[0], fullName })))

module.exports = {
  MetadataCollection,
  MetadataSelection,
  FileSelection,
  addressesFromPackage
}
