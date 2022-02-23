const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.roles.stripPartnerRoles', false)

module.exports = {
  afterRetrieve: async (ctx, { excludeFilesWhen }) => {
    if (isPluginEnabled(ctx)) excludeFilesWhen(f => /PartnerUser[0-9]*.role$/.test(f))
  }
}
