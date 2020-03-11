const get = require('lodash').get

module.exports = async (context, helpers) => {
  if (!get(context, 'config.permissionSets.stripUselessFls')) return

  helpers.xmlTransformer('permissionsets/**/*', async (filename, fJson) => {
    fJson.fieldPermissions = (fJson.fieldPermissions || []).filter(x => {
      return (x.readable && x.readable[0] === 'true') || (x.editable && x.editable[0] === 'true')
    })
  })
}
