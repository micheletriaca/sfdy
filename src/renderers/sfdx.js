const path = require('path')
const _ = require('exstream.js')
const { buildXml, parseXml } = require('../utils/xml-utils')
const objectsSplit = require('./source-formats/objects')
const objRegex = new RegExp('^' + objectsSplit.folderName + '/([^/]+)/.*$')
const makeEmptyObj = metaName => ({ [metaName]: { $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' } } })

const splitTag = (includeFiles, dirName, xml) => (folderName, suffix, xmlTagName) => {
  const tagList = xml[folderName] || []
  tagList.forEach(x => {
    const subXml = makeEmptyObj(xmlTagName)
    subXml[xmlTagName] = { ...subXml[xmlTagName], ...x }
    includeFiles([{ data: buildXml(subXml), fileName: path.join(dirName, folderName, x.fullName[0] + `.${suffix}-meta.xml`) }])
  })
  delete xml[folderName]
}

const buildObj = async (objName, objData, addToPackage) => {
  let inMemoryObj = objData.find(x => x.fileName.endsWith(objName + objectsSplit.suffix + '-meta.xml'))
  inMemoryObj = inMemoryObj ? await parseXml(inMemoryObj.data) : makeEmptyObj(objectsSplit.objName)
  const objJson = inMemoryObj[objectsSplit.objName]

  for (const key of objectsSplit.split) {
    objJson[key[0]] = []
    const data = objData.filter(x => x.fileName.endsWith(`${key[1]}-meta.xml`))
    for (const f of data) {
      const componentName = f.fileName.match(new RegExp(`([^/]+)\\.${key[1]}-meta.xml$`))[1]
      if (componentName && objectsSplit.useChildXml) addToPackage(key[2], objName + '.' + componentName)
      objJson[key[0]].push(Object.values(await parseXml(f.data))[0])
    }
  }
  return inMemoryObj
}

module.exports = {
  isEnabled: config => config.splitObjects,

  remaps: [
    {
      transformed: `${objectsSplit.folderName}/*/**/*`,
      normalized: f => [objectsSplit.folderName + '/' + f.replace(objRegex, '$1') + objectsSplit.suffix]
    }
  ],

  metadataRemaps: objectsSplit.split.map(x => ({
    transformed: `${objectsSplit.folderName}/*/${x[0]}/*`,
    normalized: f => x[2] + '/' + f.replace(objRegex, '$1') + '.' + f.match(new RegExp(`([^/]+)\\.${x[1]}-meta.xml$`))[1]
  })),

  useChildXml: objectsSplit.useChildXml,

  transform: async (ctx, { xmlTransformer, includeFiles, removeFilesFromFilesystem, excludeFilesWhen }) => {
    ctx.logger.time('sfdx')
    await xmlTransformer(`${objectsSplit.folderName}/*${objectsSplit.suffix}`, async (filename, xml) => {
      await removeFilesFromFilesystem([filename])
      excludeFilesWhen(f => f === filename)
      const dirName = filename.replace(objectsSplit.suffix, '')
      const objName = filename.substring(filename.lastIndexOf('/') + 1)
      const xplit = splitTag(includeFiles, dirName, xml)
      for (const t of objectsSplit.split) xplit(t[0], t[1], t[2])
      if (Object.keys(xml).length > 1) {
        includeFiles([{
          data: Buffer.from(buildXml({ [objectsSplit.objName]: xml }), 'utf8'),
          fileName: path.join(dirName, objName + '-meta.xml')
        }])
      }
    })
    ctx.logger.timeEnd('sfdx')
  },

  normalize: async (ctx, { getFiles, includeFiles, excludeFilesWhen, addToPackage, removeFromPackage }) => {
    const fileList = await _(getFiles(`${objectsSplit.folderName}/*/**/*`, true, false, true, false))
      .flatten()
      .map(x => ({ ...x, objName: x.fileName.match(objRegex)[1] }))
      .filter(x => x.objName)
      .groupBy('objName')
      .value()

    for (const [obj, listByObj] of Object.entries(fileList)) {
      if (objectsSplit.useChildXml) {
        removeFromPackage(objectsSplit.objName, obj)
        addToPackage(objectsSplit.objName, obj)
      }
      includeFiles([{
        fileName: `${objectsSplit.folderName}/${obj}${objectsSplit.suffix}`,
        data: Buffer.from(buildXml(await buildObj(obj, listByObj, addToPackage)), 'utf8')
      }])
      excludeFilesWhen(`${objectsSplit.folderName}/*/**/*`)
    }
  }
}
