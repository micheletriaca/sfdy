const get = require('lodash').get
const { definePlugin } = require('../plugin')
const { transformXml } = require('./v2-utils')

module.exports = definePlugin({
  name: 'core-strip-useless-permission-set-fls',
  stage: 'metadata',

  async onRetrieve ({ files, config }) {
    if (!get(config, 'permissionSets.stripUselessFls')) return
    await transformXml(files, 'permissionsets/**/*', fJson => {
      fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => {
        return (x.readable && x.readable[0] === 'true') || (x.editable && x.editable[0] === 'true')
      })
    })
  }
})
