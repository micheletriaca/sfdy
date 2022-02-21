const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.permissionSets.stripUselessFls', false)

module.exports = async (ctx, { xmlTransformer }) => {
  if (!isPluginEnabled(ctx)) return
  await xmlTransformer('permissionsets/**/*', async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => {
      return (x.readable && x.readable[0] === 'true') || (x.editable && x.editable[0] === 'true')
    })
  })
}
