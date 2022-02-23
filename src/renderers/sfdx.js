const path = require('path')
const _ = require('exstream.js')
const { buildXml, parseXml } = require('../utils/xml-utils')

const splitTag = (includeFiles, dirName, xml) => (folderName, suffix, xmlTagName) => {
  const tagList = xml[folderName] || []
  tagList.forEach(x => {
    const subXml = { [xmlTagName]: { $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' }, ...x } }
    includeFiles([{ data: buildXml(subXml), fileName: path.join(dirName, folderName, x.fullName[0] + `.${suffix}-meta.xml`) }])
  })
  delete xml[folderName]
}

const buildObj = async (objName, objData) => {
  let customObj = objData.find(x => x.fileName.endsWith(objName + '.object-meta.xml'))
  if (customObj) customObj = await parseXml(customObj.data)
  else {
    customObj = { CustomObject: { $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' } } }
  }
  for (const key of [
    ['fields', 'field', 'CustomField'],
    ['recordTypes', 'recordType', 'RecordType'],
    ['listViews', 'listView', 'ListView'],
    ['compactLayouts', 'compactLayout', 'CompactLayout'],
    ['validationRules', 'validationRule', 'ValidationRule'],
    ['webLinks', 'webLink', 'WebLink'],
    ['businessProcesses', 'businessProcess', 'BusinessProcess'],
    ['fieldSets', 'fieldSet', 'FieldSet'],
    ['sharingReasons', 'sharingReason', 'SharingReason']
  ]) {
    customObj.CustomObject[key[0]] = []
    const data = objData.filter(x => x.fileName.endsWith(`${key[1]}-meta.xml`))
    for (const f of data) {
      f.xml = await parseXml(f.data)
      customObj.CustomObject[key[0]].push(Object.values(f.xml)[0])
    }
  }
  return customObj
}

module.exports = {
  remaps: [
    {
      transformed: 'objects/*/**/*',
      normalized: f => [f.replace(/^(objects\/[^/]+)\/.*$/, '$1') + '.object']
    }
  ],
  transform: async (ctx, { xmlTransformer, includeFiles, removeFilesFromFilesystem, excludeFilesWhen }) => {
    await xmlTransformer('objects/*.object', async (filename, xml) => {
      await removeFilesFromFilesystem([filename])
      excludeFilesWhen(f => f === filename)
      const dirName = filename.replace('.object', '')
      const objName = filename.substring(filename.lastIndexOf('/') + 1)
      const xplit = splitTag(includeFiles, dirName, xml)
      xplit('fields', 'field', 'CustomField')
      xplit('recordTypes', 'recordType', 'RecordType')
      xplit('listViews', 'listView', 'ListView')
      xplit('compactLayouts', 'compactLayout', 'CompactLayout')
      xplit('validationRules', 'validationRule', 'ValidationRule')
      xplit('webLinks', 'webLink', 'WebLink')
      xplit('businessProcesses', 'businessProcess', 'BusinessProcess')
      xplit('fieldSets', 'fieldSet', 'FieldSet')
      xplit('sharingReasons', 'sharingReason', 'SharingReason')
      if (Object.keys(xml).length > 1) {
        includeFiles([{
          data: Buffer.from(buildXml({ CustomObject: xml }), 'utf8'),
          fileName: path.join(dirName, objName + '-meta.xml')
        }])
      }
    })
  },
  normalize: async (ctx, { getFiles, includeFiles }) => {
    const fileList = await _(getFiles('objects/*/**/*', true, false))
      .flatten()
      .map(x => ({ ...x, objName: x.fileName.match(/objects\/([^/]+)/)[1] }))
      .filter(x => x.objName)
      .groupBy('objName')
      .value()

    for (const [obj, listByObj] of Object.entries(fileList)) {
      includeFiles([{
        fileName: `objects/${obj}.object`,
        data: Buffer.from(buildXml(await buildObj(obj, listByObj)), 'utf8')
      }])
    }
  }
}
