module.exports = async (context, helpers) => {
  if (!context.config.roles.stripPartnerRoles) return

  helpers.filterMetadata(fileName => {
    return !/PartnerUser[0-9]*.role$/.test(fileName)
  })
}
