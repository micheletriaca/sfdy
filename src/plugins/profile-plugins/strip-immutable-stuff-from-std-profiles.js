const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('profiles.stripUserPermissionsFromStandardProfiles', false)

module.exports = {
  isEnabled: config => isPluginEnabled(config),

  afterRetrieve: async (ctx, { xmlTransformer }) => {
    ctx.logger.time('strip-immutable-stuff-from-std-profiles')
    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      if (fJson.custom && fJson.custom[0] !== 'true') {
        fJson.userPermissions = []
        fJson.objectPermissions = []
      }
    })
    ctx.logger.timeEnd('strip-immutable-stuff-from-std-profiles')
  }
}
