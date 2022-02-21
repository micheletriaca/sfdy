const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.roles.stripPartnerRoles', false)

module.exports = {
  afterRetrieve: async (ctx, { applyMaskToExtractedFileList }) => {
    if (isPluginEnabled(ctx)) applyMaskToExtractedFileList(['**/*', '!roles/PartnerUser*'])
  }
}
