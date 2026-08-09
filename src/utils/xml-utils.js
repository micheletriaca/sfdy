const util = require('util')
const xml2js = require('xml2js')

const parser = util.promisify(new xml2js.Parser({ explicitArray: true }).parseString)
const noArrayParser = util.promisify(new xml2js.Parser({ explicitArray: false }).parseString)

const parseXmlRoot = async (value, {
  filePath = '<memory>',
  expectedRoot,
  label = 'XML file'
} = {}) => {
  let document
  try {
    document = await parser(value)
  } catch (error) {
    throw new Error(`${label} ${filePath} is not valid XML: ${error.message}`, { cause: error })
  }

  const roots = Object.keys(document || {})
  if (!roots.length) throw new Error(`${label} ${filePath} does not have an XML root element`)
  const rootName = roots[0]
  if (expectedRoot && rootName !== expectedRoot) {
    throw new Error(
      `${label} ${filePath} has XML root <${rootName}>; expected <${expectedRoot}> from its path`
    )
  }

  let root = document[rootName]
  if (root === '' || root == null) {
    root = {}
    document[rootName] = root
  }
  if (typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`${label} ${filePath} has an invalid <${rootName}> root value`)
  }
  return { document, root, rootName }
}

const renderOpts = {
  indent: '    ',
  emptyTag: true
}

const serializeValue = (tagname, v, indentLevel) => {
  let res = ''
  if (typeof (v) === 'object') {
    res += '\n'
    const keys = Object.keys(v)
    const l = keys.length
    for (let i = 0; i < l; i++) {
      const serializedSubXml = sfdcXmlBuilder(keys[i], v[keys[i]], false, indentLevel)
      res += serializedSubXml + (serializedSubXml ? '\n' : '')
    }
  } else {
    v = v + ''
    const l = v.length
    for (let i = 0; i < l; i++) {
      const c = v[i]
      if (c === '&') {
        res += '&amp;'
      } else if (c === '<') {
        res += '&lt;'
      } else if (c === '>') {
        res += '&gt;'
      } else if (c === '"') {
        res += '&quot;'
      } else if (c === "'") {
        res += '&apos;'
      } else {
        res += c
      }
    }
  }
  return res
}

const buildTag = (tagname, attributes) => {
  let res = '<' + tagname
  const attrs = Object.keys(attributes).map(k => `${k}="${attributes[k]}"`).join(' ')
  if (attrs) res += ' ' + attrs
  res += '>'
  return res
}

/**
 *  We need a custom xml serializer because salesfore escapes perfectly valid chars in xml (such as ' or ")
 *  and xml2js does not handle this weirdness
 */
const sfdcXmlBuilder = (tagname, value, isRoot = true, indentLevel = '') => {
  let res = isRoot ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
  if (!Array.isArray(value)) value = [value]
  const l = value.length
  for (let i = 0; i < l; i++) {
    const isObject = typeof (value[i]) === 'object' && !Object.prototype.hasOwnProperty.call(value[i], '_')
    res += indentLevel + buildTag(tagname, value[i].$ || {})
    delete value[i].$
    const serializedValue = serializeValue(tagname, value[i]._ || value[i], indentLevel + renderOpts.indent)
    res += serializedValue
    if (!serializedValue && renderOpts.emptyTag) res = res.replace(/>$/, '/>')
    else res += (isObject ? indentLevel : '') + '</' + tagname + '>'
    if (i < value.length - 1) res += '\n'
  }
  return res
}

module.exports = {
  parseXml: parser,
  parseXmlRoot,
  parseXmlNoArray: noArrayParser,
  buildXml: v => sfdcXmlBuilder(Object.keys(v)[0], Object.values(v)[0])
}
