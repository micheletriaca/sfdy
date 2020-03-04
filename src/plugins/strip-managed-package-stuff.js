module.exports = async (context, helpers) => {
  if (!context.config.stripManagedPackageFields) return

  const namespaces = context.config.stripManagedPackageFields
  const fn = apiName => x => !namespaces.some(mp => x[apiName][0].startsWith(mp))
  helpers.xmlTransformer('objects/**/*', async (filename, fJson) => {
    fJson.fields = (fJson.fields || []).filter(fn('fullName'))
    fJson.webLinks = (fJson.webLinks || []).filter(fn('fullName'))
    ;(fJson.recordTypes || [])
      .filter(v => v.picklistValues)
      .forEach(v => (v.picklistValues = v.picklistValues.filter(fn('picklist'))))
  })

  helpers.xmlTransformer('permissionsets/**/*', async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(fn('field'))
  })

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(fn('field'))
  })
}
