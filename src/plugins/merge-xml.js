const _ = require('exstream.js')
const { parseXml, buildXml } = require('../utils/xml-utils')
const { getChildXmlMap } = require('../utils/package-utils')

const objectStructure = {
  businessProcesses: 'fullName',
  compactLayouts: 'fullName',
  fields: 'fullName',
  fieldSets: 'fullName',
  indexes: 'fullName',
  listViews: 'fullName',
  recordTypes: [
    { picklistValues: 'picklist' },
    'fullName'
  ],
  sharingReasons: 'fullName',
  validationRules: 'fullName',
  webLinks: 'fullName'
}

const profileStructure = {
  applicationVisibilities: 'application',
  fieldPermissions: 'field',
  classAccesses: 'apexClass',
  // layoutAssignments: 'layout'  //TODO -> I LAYOUT HANNO UNA CHIAVE COMPOSITA
  objectPermissions: 'object',
  recordTypeVisibilities: 'recordType',
  tabVisibilities: 'tab',
  userPermissions: 'name'
}

const structures = {
  objects: objectStructure,
  profiles: profileStructure
}

const processXml = (baseInMemory, baseInFilesystem, structure) => {
  const sorter = (a, b) => {
    if (a[0] === 'fullName') return -1
    if (b[0] === 'fullName') return 1
    return a[0] > b[0] ? 1 : -1
  }
  return _(Object.entries(baseInFilesystem))
    .sortBy(sorter)
    .reduce((res, [key, v]) => {
      if (!structure[key]) {
        res[key] = v
        return res
      } else if (!baseInFilesystem[key]) {
        return res
      } else if (!baseInMemory[key]) {
        res[key] = baseInFilesystem[key]
        return res
      } else {
        const keys = structure[key]
        for (const subkey of Array.isArray(keys) ? keys : [keys]) {
          if (typeof subkey === 'object') {
            const realKey = keys[keys.length - 1]
            const allItems = _([...baseInMemory[key].map(x => x[realKey][0]), ...baseInFilesystem[key].map(x => x[realKey][0])]).uniq().values()
            baseInMemory[key] = allItems.map(x => processXml(baseInMemory[key].find(y => y[realKey][0] === x) || {}, baseInFilesystem[key].find(y => y[realKey][0] === x) || {}, subkey))
          } else {
            const memFs = _(baseInFilesystem[key]).keyBy(x => x[subkey][0]).value()
            _(baseInMemory[key]).each(x => { memFs[x[subkey][0]] = x })
            res[key] = Object.values(memFs).sort((a, b) => a[subkey][0] > b[subkey][0] ? 1 : -1)
          }
        }
        return res
      }
    }, {})
    .value()
}

const mergeXml = async (inMemory, inFilesystem, structure) => {
  if (!inFilesystem) return
  const xmlInMemory = await parseXml(inMemory.data)
  const xmlInFilesystem = await parseXml(inFilesystem.data)
  const baseInMemory = Object.values(xmlInMemory)[0]
  const baseInFilesystem = Object.values(xmlInFilesystem)[0]
  const key = Object.keys(xmlInMemory)[0]
  xmlInMemory[key] = processXml(baseInMemory, baseInFilesystem, structure)

  inMemory.data = Buffer.from(buildXml(xmlInMemory) + '\n', 'utf8')
}

const substringBefore = (str, char) => {
  if (!str) return str
  const idx = str.indexOf(char)
  if (idx === -1) return str
  else return str.substring(0, idx)
}

module.exports = {
  isEnabled: () => true,

  afterRetrieve: async (ctx, { getFiles }) => {
    const childXmlMap = getChildXmlMap()
    const childXmlInPackage = ctx._raw.allMetaInPackage.filter(x => childXmlMap[x.split('/')[0]])

    const typesToMerge = []
    if (ctx.config.profileStrategy === 'merge') typesToMerge.push('profiles/*.profile')
    if (!ctx.config.splitObjects && childXmlInPackage.length) typesToMerge.push('objects/*.object')

    const typesToMergeInMemory = await _(getFiles(typesToMerge, true, false, true))
      .flatten()
      .keyBy('fileName')
      .value()

    const typesToMergeInFilesystem = await _(getFiles(Object.keys(typesToMergeInMemory), true, true, false))
      .flatten()
      .keyBy('fileName')
      .value()

    for (const x in typesToMergeInMemory) {
      const metaRootName = substringBefore(typesToMergeInMemory[x].fileName, '/')
      await mergeXml(typesToMergeInMemory[x], typesToMergeInFilesystem[x], structures[metaRootName])
    }
  }
}
