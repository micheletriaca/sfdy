const { parseXml } = require('../utils/xml-utils')
const _ = require('highland')
const get = require('lodash').get

const getFieldMap = async objectFileNames => {
  return _(objectFileNames)
    .map(async x => ({
      content: x.transformedJson || await parseXml(x.data),
      obj: x.fileName.replace(/^objects\/(.*)\.object$/, '$1')
    }))
    .map(x => _(x))
    .sequence()
    .flatMap(objData => (objData.content.CustomObject.fields || []).map(x => `${objData.obj}.${x.fullName[0]}`))
    .flatMap(field => {
      const res = [field]
      if (field.startsWith('Activity.')) {
        res.push(field.replace('Activity.', 'Event.'))
        res.push(field.replace('Activity.', 'Task.'))
      }
      return res
    })
    .collect()
    .map(x => new Set(x))
    .toPromise(Promise)
}

module.exports = async (context, helpers) => {
  const cachedGetFieldMap = (cache => async allFiles => cache || (cache = await getFieldMap(allFiles)))()

  if (get(context, 'config.profiles.stripUnversionedFields')) {
    helpers.xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
      const fieldMap = await cachedGetFieldMap(await requireFiles('objects/**/*'))
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => fieldMap.has(x.field[0]))
    })
  }

  if (get(context, 'config.objectTranslations.stripNotVersionedFields')) {
    helpers.xmlTransformer('objectTranslations/**/*', async (filename, fJson, requireFiles) => {
      const fieldMap = await cachedGetFieldMap(await requireFiles('objects/**/*'))
      fJson.fields = (fJson.fields || []).filter(x => fieldMap.has(x.field[0]))
    })
  }
}
