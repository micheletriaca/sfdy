const get = require('lodash').get
const { definePlugin } = require('../plugin')
const { transformXml } = require('./v2-utils')

const getFieldMap = async objectFiles => {
  const fields = await Promise.all(objectFiles.map(async file => {
    let object
    try {
      object = await file.readXml()
    } catch (error) {
      throw new Error(`There was an error parsing ${file.path}: ${error.message}`)
    }
    const objectName = file.path.replace(/^objects\/(.*)\.object$/, '$1')
    return (object.fields || []).flatMap(field => {
      const fullName = `${objectName}.${field.fullName[0]}`
      return fullName.startsWith('Activity.')
        ? [fullName, fullName.replace('Activity.', 'Event.'), fullName.replace('Activity.', 'Task.')]
        : [fullName]
    })
  }))
  return new Set(fields.flat())
}

module.exports = definePlugin({
  name: 'core-strip-unversioned-profile-content',
  stage: 'metadata',

  async onRetrieve ({ files, project, config }) {
    let fieldMap
    const versionedFields = async () =>
      fieldMap || (fieldMap = await getFieldMap(project.match('objects/**/*')))

    if (get(config, 'profiles.stripUnversionedStuff')) {
      const classes = new Set(project.match('classes/**/*').map(file => file.path))
      const pages = new Set(project.match('pages/**/*').map(file => file.path))
      const layouts = new Set(project.match('layouts/**/*').map(file => file.path))
      await transformXml(files, 'profiles/**/*', async fJson => {
        const fields = await versionedFields()
        fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => fields.has(x.field[0]))
        fJson.classAccesses = (fJson.classAccesses || [])
          .filter(x => classes.has(`classes/${x.apexClass[0]}.cls`))
        fJson.pageAccesses = (fJson.pageAccesses || [])
          .filter(x => pages.has(`pages/${x.apexPage[0]}.page`))
        fJson.layoutAssignments = (fJson.layoutAssignments || [])
          .filter(x => layouts.has(`layouts/${x.layout[0]}.layout`))
      })
    }

    if (get(config, 'objectTranslations.stripNotVersionedFields')) {
      await transformXml(files, 'objectTranslations/**/*', async (fJson, file) => {
        const fields = await versionedFields()
        const objectName = file.path.replace(/^objectTranslations\/(.*)-.*\.objectTranslation$/, '$1')
        fJson.fields = (fJson.fields || []).filter(x => fields.has(`${objectName}.${x.name[0]}`))
      })
    }
  }
})
