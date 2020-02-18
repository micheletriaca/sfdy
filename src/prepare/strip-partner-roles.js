const path = require('path')
const pathService = require('../services/path-service')
const fs = require('fs')

const ROLES_PATH = path.resolve(pathService.getBasePath(), 'src/roles')

module.exports = (config) => {
  if (!fs.existsSync(ROLES_PATH) || !config.roles || !config.roles.stripPartnerRoles) return true
  fs.readdirSync(ROLES_PATH).forEach(f => {
    if (f.match('PartnerUser[0-9]*.role')) fs.unlinkSync(path.resolve(ROLES_PATH, f))
  })
}
