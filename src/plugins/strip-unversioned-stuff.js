const { parseXml } = require('../utils/xml-utils')
const _ = require('exstream.js')
const isStripUnversionedPluginEnabled = _.makeGetter('config.profiles.stripUnversionedStuff', false)
const isStripUnversionedFieldsPluginEnabled = _.makeGetter('config.objectTranslations.stripNotVersionedFields', false)

// TODO -> IN QUESTO CASO SE HO RICHIESTO CAMPI NELLO STESSO RETRIEVE NON DOVREI STRIPPARLI
// TODO -> SERVE UN GetFileFromEverything

const getFieldMap = async objFileNames => _(objFileNames)
  .asyncMap(async x => ({
    content: x.transformed || await parseXml(x.data),
    obj: x.fileName.replace(/^objects\/(.*)\.object$/, '$1')
  }))
  .flatMap(objData => (objData.content.CustomObject.fields || []).map(x => `${objData.obj}.${x.fullName[0]}`))
  .flatMap(field => {
    const res = [field]
    if (field.startsWith('Activity.')) {
      res.push(field.replace('Activity.', 'Event.'))
      res.push(field.replace('Activity.', 'Task.'))
    }
    return res
  })
  .toSet()

module.exports = async (ctx, { xmlTransformer, getFilesFromFilesystem }) => {
  const cachedGetFieldMap = (cache => async allFiles => cache || (cache = await getFieldMap(allFiles)))()

  if (isStripUnversionedPluginEnabled(ctx)) {
    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      const fieldMap = await cachedGetFieldMap(await getFilesFromFilesystem('objects/**/*'))
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => fieldMap.has(x.field[0]))

      const classes = new Set(await getFilesFromFilesystem('classes/**/*', false))
      fJson.classAccesses = (fJson.classAccesses || []).filter(x => classes.has('classes/' + x.apexClass[0] + '.cls'))

      const pages = new Set(await getFilesFromFilesystem('pages/**/*', false))
      fJson.pageAccesses = (fJson.pageAccesses || []).filter(x => pages.has('pages/' + x.apexPage[0] + '.page'))

      const layouts = new Set(await getFilesFromFilesystem('layouts/**/*', false))
      fJson.layoutAssignments = (fJson.layoutAssignments || []).filter(x => layouts.has('layouts/' + x.layout[0] + '.layout'))
    })
  }

  if (isStripUnversionedFieldsPluginEnabled(ctx)) {
    await xmlTransformer('objectTranslations/**/*', async (filename, fJson) => {
      const fieldMap = await cachedGetFieldMap(await getFilesFromFilesystem('objects/**/*'))
      const objName = filename.replace(/^objectTranslations\/(.*)-.*\.objectTranslation$/, '$1')
      fJson.fields = (fJson.fields || []).filter(x => fieldMap.has(objName + '.' + x.name[0]))
    })
  }
}
