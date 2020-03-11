const get = require('lodash').get

module.exports = async (context, helpers) => {
  if (!get(context, 'config.profiles.stripUserPermissionsFromStandardProfiles')) return

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson) => {
    if (fJson.custom && fJson.custom[0] !== 'true') {
      fJson.userPermissions = []
      fJson.objectPermissions = []
    }
  })
}
