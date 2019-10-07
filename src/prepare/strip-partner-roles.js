const path = require('path')
const fs = require('fs')

const ROLES_PATH = path.resolve(process.cwd(), 'src/roles')

module.exports = (config) => {
  if (!fs.existsSync(ROLES_PATH) || !config.roles || !config.roles.stripPartnerRoles) return true
  fs.readdirSync(ROLES_PATH).forEach(f => {
    if (f.match('PartnerUser[0-9]*.role')) fs.unlinkSync(path.resolve(ROLES_PATH, f))
  })
}
