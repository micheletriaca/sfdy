const path = require('path')
const pathService = require('../services/path-service')
const fs = require('fs')

module.exports = (config) => {
  if (!fs.existsSync(pathService.getRolesPath()) || !config.roles || !config.roles.stripPartnerRoles) return true
  fs.readdirSync(pathService.getRolesPath()).forEach(f => {
    if (f.match('PartnerUser[0-9]*.role')) fs.unlinkSync(path.resolve(pathService.getRolesPath(), f))
  })
}
