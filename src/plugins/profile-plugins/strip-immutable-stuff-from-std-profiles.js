module.exports = async (context, helpers) => {
  if (!context.config.profiles.stripUserPermissionsFromStandardProfiles) return

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson) => {
    if (fJson.custom && fJson.custom[0] !== 'true') {
      fJson.userPermissions = []
      fJson.objectPermissions = []
    }
  })
}
