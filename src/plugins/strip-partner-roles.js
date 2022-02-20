const _ = require('highland')

module.exports = async (context, helpers) => {
  const get = _.makeGetter('config.roles.stripPartnerRoles')
  if (!get(context)) return

  helpers.filterMetadata(fileName => {
    return !/PartnerUser[0-9]*.role$/.test(fileName)
  })
}
