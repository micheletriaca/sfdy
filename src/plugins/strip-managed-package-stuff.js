const afterRetrieve = async (namespaces, xmlTransformer) => {
  const fn = apiName => x => !namespaces.some(mp => x[apiName][0].startsWith(mp))

  await xmlTransformer('objects/**/*', async (filename, fJson) => {
    fJson.fields = (fJson.fields || []).filter(fn('fullName'))
    fJson.webLinks = (fJson.webLinks || []).filter(fn('fullName'))
    ;(fJson.recordTypes || [])
      .filter(v => v.picklistValues)
      .forEach(v => (v.picklistValues = v.picklistValues.filter(fn('picklist'))))
  })

  await xmlTransformer(['permissionsets/**/*', 'profiles/**/*'], async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(fn('field'))
  })
}

module.exports = {
  afterRetrieve: async (ctx, { xmlTransformer }) => {
    if (!ctx.config.stripManagedPackageFields) return
    await afterRetrieve(ctx.config.stripManagedPackageFields, xmlTransformer)
  }
}
