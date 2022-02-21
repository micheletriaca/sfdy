const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.roles.stripPartnerRoles', false)

module.exports = {
  afterRetrieve: async (ctx, { excludeFilesFromExtractedFileList }) => {
    if (isPluginEnabled(ctx)) excludeFilesFromExtractedFileList(['roles/PartnerUser*'])
  }
}
