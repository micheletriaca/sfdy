const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.profiles.stripUserPermissionsFromStandardProfiles', false)

module.exports = {
  afterRetrieve: async (ctx, { xmlTransformer }) => {
    if (!isPluginEnabled(ctx)) return
    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      if (fJson.custom && fJson.custom[0] !== 'true') {
        fJson.userPermissions = []
        fJson.objectPermissions = []
      }
    })
  }
}
