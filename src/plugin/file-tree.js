const path = require('path')
const multimatch = require('multimatch')
const { parseXmlRoot, buildXml } = require('../utils/xml-utils')

const normalizePath = value => value.split(path.sep).join('/').replace(/^\.\//, '')
const asPatterns = patterns => Array.isArray(patterns) ? patterns : [patterns]
const matches = (paths, patterns) => multimatch(paths, asPatterns(patterns))
const cloneBuffer = value => Buffer.from(value || '')
const recordFromEntry = (entry, attributes) => {
  const value = entry.data === undefined ? entry.contents : entry.data
  return {
    ...(value === undefined && entry.loadData
      ? { loadData: entry.loadData }
      : { data: cloneBuffer(value) }),
    ...attributes
  }
}

class ProjectFile {
  constructor (tree, filePath, layer = 'project') {
    this._tree = tree
    this.path = filePath
    this._layer = layer
  }

  get origin () {
    return this._tree._getRecord(this.path, this._layer)?.origin || 'disk'
  }

  async readBytes () {
    const record = this._tree._getRecord(this.path, this._layer)
    if (!record) throw new Error(`File not found: ${this.path}`)
    return cloneBuffer(this._tree._recordData(record))
  }

  async readText (encoding = 'utf8') {
    return (await this.readBytes()).toString(encoding)
  }

  async readXml () {
    const record = this._tree._getRecord(this.path, this._layer)
    if (!record) throw new Error(`File not found: ${this.path}`)
    if (record.xmlDocument) return structuredClone(record.xmlDocument)
    const parsed = await parseXmlRoot(this._tree._recordData(record), {
      filePath: this.path,
      label: 'Plugin XML file'
    })
    record.xmlRoot = parsed.rootName
    record.xmlDocument = structuredClone(parsed.root)
    return structuredClone(record.xmlDocument)
  }
}

class MutableFile extends ProjectFile {
  constructor (tree, filePath) {
    super(tree, filePath, 'files')
  }

  writeBytes (contents) {
    this._tree._write(this.path, contents)
    return this
  }

  writeText (contents, encoding = 'utf8') {
    return this.writeBytes(Buffer.from(contents, encoding))
  }

  async writeXml (xml) {
    const record = this._tree._getRecord(this.path, 'files')
    if (!record) throw new Error(`File not found: ${this.path}`)
    let root = record.xmlRoot
    if (!root) {
      root = (await parseXmlRoot(record.data, {
        filePath: this.path,
        label: 'Plugin XML file'
      })).rootName
    }
    this._tree._writeXml(this.path, root, xml)
    return this
  }

  exclude () {
    this._tree._exclude(this.path)
    return this
  }

  delete () {
    this._tree._delete(this.path)
    return this
  }
}

class ProjectView {
  constructor (tree, layer) {
    this._tree = tree
    this._layer = layer
  }

  match (patterns) {
    return matches(this._tree._paths(this._layer), patterns)
      .map(filePath => new ProjectFile(this._tree, filePath, this._layer))
  }

  get (filePath) {
    const normalized = normalizePath(filePath)
    return this._tree._getRecord(normalized, this._layer)
      ? new ProjectFile(this._tree, normalized, this._layer)
      : undefined
  }

  has (filePath) {
    return !!this._tree._getRecord(normalizePath(filePath), this._layer)
  }
}

class FileSet {
  constructor (tree) {
    this._tree = tree
  }

  match (patterns) {
    return matches(this._tree._paths('files'), patterns)
      .map(filePath => new MutableFile(this._tree, filePath))
  }

  get (filePath) {
    const normalized = normalizePath(filePath)
    return this._tree._getRecord(normalized, 'files')
      ? new MutableFile(this._tree, normalized)
      : undefined
  }

  has (filePath) {
    return !!this._tree._getRecord(normalizePath(filePath), 'files')
  }

  include (file) {
    if (!(file instanceof ProjectFile)) throw new TypeError('files.include expects a project file')
    const record = file._tree._getRecord(file.path, file._layer)
    if (!record) throw new Error(`File not found: ${file.path}`)
    this._tree._include(file.path, record)
    return new MutableFile(this._tree, file.path)
  }

  create ({ path: filePath, contents = Buffer.alloc(0) }) {
    const normalized = normalizePath(filePath)
    this._tree._create(normalized, contents)
    return new MutableFile(this._tree, normalized)
  }

  exclude (patterns) {
    this.match(patterns).forEach(file => file.exclude())
  }

  excludeWhere (predicate) {
    this.match('**/*').forEach(file => {
      if (predicate(file)) file.exclude()
    })
  }

  delete (patterns) {
    const expandedPatterns = asPatterns(patterns).flatMap(pattern =>
      /[*?![\]{}()]/.test(pattern) ? [pattern] : [pattern, `${pattern.replace(/\/$/, '')}/**/*`])
    const paths = matches(this._tree._paths('project'), expandedPatterns)
    paths.forEach(filePath => this._tree._delete(filePath))
  }

  entries () {
    return this._tree.entries()
  }
}

class OutputWorkspace {
  constructor (tree) {
    this._tree = tree
  }

  delete (patterns) {
    const expandedPatterns = asPatterns(patterns).flatMap(pattern =>
      /[*?![\]{}()]/.test(pattern) ? [pattern] : [pattern, `${pattern.replace(/\/$/, '')}/**/*`])
    const paths = matches(this._tree._paths('project'), expandedPatterns)
    paths.forEach(filePath => this._tree._outputDeleted.add(filePath))
  }
}

class FileTree {
  constructor ({ diskEntries = [], files = [], origin = 'incoming' } = {}) {
    this._disk = new Map()
    this._files = new Map()
    this._deleted = new Set()
    this._outputDeleted = new Set()
    this._initial = new Set()

    diskEntries.forEach(entry => {
      const normalized = normalizePath(entry.fileName || entry.path)
      this._disk.set(normalized, recordFromEntry(entry, { origin: 'disk' }))
    })
    files.forEach(entry => {
      const normalized = normalizePath(entry.fileName || entry.path)
      this._files.set(normalized, recordFromEntry(entry, {
        origin: entry.origin || origin,
        excluded: false,
        modified: false,
        created: false
      }))
      this._initial.add(normalized)
    })

    this.files = new FileSet(this)
    this.project = new ProjectView(this, 'project')
    this.disk = new ProjectView(this, 'disk')
    this.output = new OutputWorkspace(this)
  }

  _paths (layer) {
    if (layer === 'disk') return [...this._disk.keys()]
    if (layer === 'files') {
      return [...this._files.entries()]
        .filter(([filePath, record]) => !record.excluded && !this._deleted.has(filePath))
        .map(([filePath]) => filePath)
    }
    return [...new Set([...this._disk.keys(), ...this._files.keys()])]
      .filter(filePath => !!this._getRecord(filePath, 'project'))
  }

  _getRecord (filePath, layer) {
    if (layer === 'disk') return this._disk.get(filePath)
    if (this._deleted.has(filePath)) return undefined
    const active = this._files.get(filePath)
    if (layer === 'files') return active && !active.excluded ? active : undefined
    if (active && !active.excluded) return active
    if (this._outputDeleted.has(filePath)) return undefined
    return this._disk.get(filePath)
  }

  _recordData (record) {
    if (record.xmlDirty) {
      record.data = Buffer.from(buildXml({
        [record.xmlRoot]: structuredClone(record.xmlDocument)
      }) + '\n')
      record.xmlDirty = false
      record.loadData = undefined
    }
    if (record.data === undefined) {
      record.data = cloneBuffer(record.loadData ? record.loadData() : undefined)
      record.loadData = undefined
    }
    return record.data
  }

  _include (filePath, record) {
    this._deleted.delete(filePath)
    this._files.set(filePath, {
      data: cloneBuffer(this._recordData(record)),
      origin: record.origin || 'disk',
      excluded: false,
      modified: false,
      created: !this._disk.has(filePath)
    })
  }

  _create (filePath, contents) {
    if (this._getRecord(filePath, 'project')) throw new Error(`File already exists: ${filePath}`)
    this._deleted.delete(filePath)
    this._files.set(filePath, {
      data: cloneBuffer(contents),
      origin: 'generated',
      excluded: false,
      modified: false,
      created: true
    })
  }

  _write (filePath, contents) {
    const record = this._files.get(filePath)
    if (!record || record.excluded || this._deleted.has(filePath)) {
      throw new Error(`File is not part of the operation: ${filePath}`)
    }
    record.data = cloneBuffer(contents)
    record.loadData = undefined
    record.modified = true
    record.xmlRoot = undefined
    record.xmlDocument = undefined
    record.xmlDirty = false
  }

  _writeXml (filePath, root, xml) {
    const record = this._files.get(filePath)
    if (!record || record.excluded || this._deleted.has(filePath)) {
      throw new Error(`File is not part of the operation: ${filePath}`)
    }
    record.xmlRoot = root
    record.xmlDocument = structuredClone(xml)
    record.xmlDirty = true
    record.modified = true
  }

  _exclude (filePath) {
    const record = this._files.get(filePath)
    if (record) record.excluded = true
  }

  _delete (filePath) {
    this._deleted.add(filePath)
    const record = this._files.get(filePath)
    if (record) record.excluded = true
  }

  entries () {
    return this._paths('files').map(fileName => ({
      fileName,
      data: cloneBuffer(this._recordData(this._files.get(fileName)))
    }))
  }

  deletedPaths () {
    return [...new Set([...this._deleted, ...this._outputDeleted])]
  }

  markDeleted (paths) {
    this.output.delete(paths)
  }

  diff () {
    const created = []
    const modified = []
    const excluded = []
    for (const [filePath, record] of this._files) {
      if (this._deleted.has(filePath)) continue
      if (record.excluded) excluded.push(filePath)
      else if (record.created || !this._disk.has(filePath)) created.push(filePath)
      else if (record.modified || !this._recordData(record).equals(this._recordData(this._disk.get(filePath)))) modified.push(filePath)
    }
    return {
      created,
      modified,
      excluded,
      deleted: this.deletedPaths()
    }
  }
}

module.exports = {
  FileTree,
  ProjectFile,
  MutableFile
}
