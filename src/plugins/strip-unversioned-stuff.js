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

  if (get(context, 'config.profiles.stripUnversionedStuff')) {
    helpers.xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
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
    helpers.xmlTransformer('objectTranslations/**/*', async (filename, fJson, requireFiles) => {
      const fieldMap = await cachedGetFieldMap(await requireFiles('objects/**/*'))
      const objName = filename.replace(/^objectTranslations\/(.*)-.*\.objectTranslation$/, '$1')
      fJson.fields = (fJson.fields || []).filter(x => fieldMap.has(objName + '.' + x.name[0]))
    })
  }
}
