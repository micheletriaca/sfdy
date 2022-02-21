const { parseXml } = require('../utils/xml-utils')
const _ = require('exstream.js')
const get = require('lodash').get

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

module.exports = async (context, { xmlTransformer }) => {
  const cachedGetFieldMap = (cache => async allFiles => cache || (cache = await getFieldMap(allFiles)))()

  if (get(context, 'config.profiles.stripUnversionedStuff')) {
    await xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
      const fieldMap = await cachedGetFieldMap(await requireFiles('objects/**/*'))
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => fieldMap.has(x.field[0]))

      const classes = new Set((await requireFiles('classes/**/*')).map(x => x.fileName))
      fJson.classAccesses = (fJson.classAccesses || []).filter(x => classes.has('classes/' + x.apexClass[0] + '.cls'))

      const pages = new Set((await requireFiles('pages/**/*')).map(x => x.fileName))
      fJson.pageAccesses = (fJson.pageAccesses || []).filter(x => pages.has('pages/' + x.apexPage[0] + '.page'))

      const layouts = new Set((await requireFiles('layouts/**/*')).map(x => x.fileName))
      fJson.layoutAssignments = (fJson.layoutAssignments || []).filter(x => layouts.has('layouts/' + x.layout[0] + '.layout'))
    })
  }

  if (get(context, 'config.objectTranslations.stripNotVersionedFields')) {
    await xmlTransformer('objectTranslations/**/*', async (filename, fJson, requireFiles) => {
      const fieldMap = await cachedGetFieldMap(await requireFiles('objects/**/*'))
      const objName = filename.replace(/^objectTranslations\/(.*)-.*\.objectTranslation$/, '$1')
      fJson.fields = (fJson.fields || []).filter(x => fieldMap.has(objName + '.' + x.name[0]))
    })
  }
}
