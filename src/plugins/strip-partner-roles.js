const get = require('lodash').get

module.exports = async (context, helpers) => {
  if (!get(context, 'config.roles.stripPartnerRoles')) return

  helpers.filterMetadata(fileName => {
    return !/PartnerUser[0-9]*.role$/.test(fileName)
  })
}
