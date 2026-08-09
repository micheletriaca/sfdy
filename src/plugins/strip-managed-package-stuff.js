const { definePlugin } = require('../plugin')
const { transformXml } = require('./v2-utils')

module.exports = definePlugin({
  name: 'core-strip-managed-package-fields',
  stage: 'metadata',

  async onRetrieve ({ files, config }) {
    if (!config.stripManagedPackageFields) return

    const namespaces = config.stripManagedPackageFields
    const keepUnmanaged = apiName => value => !namespaces.some(namespace =>
      value[apiName][0].startsWith(namespace))
    await transformXml(files, 'objects/**/*', fJson => {
      fJson.fields = (fJson.fields || []).filter(keepUnmanaged('fullName'))
      fJson.webLinks = (fJson.webLinks || []).filter(keepUnmanaged('fullName'))
      ;(fJson.recordTypes || [])
        .filter(value => value.picklistValues)
        .forEach(value => (value.picklistValues = value.picklistValues.filter(keepUnmanaged('picklist'))))
    })
    await transformXml(files, 'permissionsets/**/*', fJson => {
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(keepUnmanaged('field'))
    })
    await transformXml(files, 'profiles/**/*', fJson => {
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(keepUnmanaged('field'))
    })
  }
})
