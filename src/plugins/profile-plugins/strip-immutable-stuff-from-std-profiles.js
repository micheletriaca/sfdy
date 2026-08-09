const get = require('lodash').get
const { definePlugin } = require('../../plugin')
const { transformXml } = require('../v2-utils')

module.exports = definePlugin({
  name: 'core-strip-standard-profile-permissions',
  stage: 'metadata',

  async onRetrieve ({ files, config }) {
    if (!get(config, 'profiles.stripUserPermissionsFromStandardProfiles')) return
    await transformXml(files, 'profiles/**/*', fJson => {
      if (fJson.custom && fJson.custom[0] !== 'true') {
        fJson.userPermissions = []
        fJson.objectPermissions = []
      }
    })
  }
})
