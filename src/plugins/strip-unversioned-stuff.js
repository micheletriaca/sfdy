const { parseXml } = require('../utils/xml-utils')
const _ = require('exstream.js')
const isStripUnversionedPluginEnabled = _.makeGetter('profiles.stripUnversionedStuff', false)
const isStripUnversionedFieldsPluginEnabled = _.makeGetter('objectTranslations.stripNotVersionedFields', false)

const getFieldMap = async (logger, objFileNames) => {
  logger.time('strip-unversioned-stuff/getFieldMap')
  return _(objFileNames)
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
    .on('end', () => logger.timeEnd('strip-unversioned-stuff/getFieldMap'))
    .toSet()
}

module.exports = {
  isEnabled: config => isStripUnversionedPluginEnabled(config) || isStripUnversionedFieldsPluginEnabled(config),

  afterRetrieve: async (ctx, { xmlTransformer, getFiles }) => {
    ctx.logger.time('strip-unversioned-stuff')

    const hasFilesToProcess = []
    if (isStripUnversionedPluginEnabled(ctx.config)) hasFilesToProcess.push('profiles/**/*')
    if (isStripUnversionedFieldsPluginEnabled(ctx.config)) hasFilesToProcess.push('objectTranslations/**/*')
    const filesToProcess = await getFiles(hasFilesToProcess, true, false, true)
    if (!filesToProcess.length) {
      ctx.logger.timeEnd('strip-unversioned-stuff')
      return
    }

    const fieldMap = await getFieldMap(ctx.logger, await getFiles('objects/**/*'))

    if (isStripUnversionedPluginEnabled(ctx.config)) {
      ctx.logger.time('strip-unversioned-stuff/profiles')
      const classes = new Set(await getFiles('classes/**/*', false))
      const pages = new Set(await getFiles('pages/**/*', false))
      const layouts = new Set(await getFiles('layouts/**/*', false))

      await xmlTransformer('profiles/**/*', async (filename, fJson) => {
        fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => fieldMap.has(x.field[0]))
        fJson.classAccesses = (fJson.classAccesses || []).filter(x => classes.has('classes/' + x.apexClass[0] + '.cls'))
        fJson.pageAccesses = (fJson.pageAccesses || []).filter(x => pages.has('pages/' + x.apexPage[0] + '.page'))
        fJson.layoutAssignments = (fJson.layoutAssignments || []).filter(x => layouts.has('layouts/' + x.layout[0] + '.layout'))
      })
      ctx.logger.timeEnd('strip-unversioned-stuff/profiles')
    }

    if (isStripUnversionedFieldsPluginEnabled(ctx.config)) {
      ctx.logger.time('strip-unversioned-stuff/translations')
      await xmlTransformer('objectTranslations/**/*', async (filename, fJson) => {
        const objName = filename.replace(/^objectTranslations\/(.*)-.*\.objectTranslation$/, '$1')
        fJson.fields = (fJson.fields || []).filter(x => fieldMap.has(objName + '.' + x.name[0]))
      })
      ctx.logger.timeEnd('strip-unversioned-stuff/translations')
    }
    ctx.logger.timeEnd('strip-unversioned-stuff')
  }
}
