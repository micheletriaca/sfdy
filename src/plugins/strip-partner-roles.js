const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.roles.stripPartnerRoles', false)

module.exports = {
  afterRetrieve: async (ctx, { excludeFiles }) => {
    if (isPluginEnabled(ctx)) excludeFiles(f => /PartnerUser[0-9]*.role$/.test(f))
  }
}
