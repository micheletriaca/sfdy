const afterRetrieve = async (namespaces, xmlTransformer) => {
  const fn = apiName => x => !namespaces.some(mp => x[apiName][0].startsWith(mp))

  await xmlTransformer('objects/*.object', async (filename, fJson) => {
    fJson.fields = (fJson.fields || []).filter(fn('fullName'))
    fJson.webLinks = (fJson.webLinks || []).filter(fn('fullName'))
    ;(fJson.recordTypes || [])
      .filter(v => v.picklistValues)
      .forEach(v => (v.picklistValues = v.picklistValues.filter(fn('picklist'))))
  })

  await xmlTransformer(['permissionsets/*.permissionset', 'profiles/*.profile'], async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(fn('field'))
  })
}

module.exports = {
  afterRetrieve: async (ctx, { xmlTransformer }) => {
    ctx.logger.time('strip-managed-package-stuff')
    if (!ctx.config.stripManagedPackageFields) return
    await afterRetrieve(ctx.config.stripManagedPackageFields, xmlTransformer)
    ctx.logger.timeEnd('strip-managed-package-stuff')
  }
}
