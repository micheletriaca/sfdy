
const { parseXml, buildXml } = require('../utils/xml-utils')
const path = require('path')
const fs = require('fs')
const _ = require('highland')

const PERMISSION_SET_PATH = path.resolve(process.cwd(), 'src/permissionsets')

module.exports = async (config) => {
  if (!fs.existsSync(PERMISSION_SET_PATH) || !config.permissionSets || !config.permissionSets.stripUselessFls) return true
  return _(fs.readdirSync(PERMISSION_SET_PATH))
    .map(async f => {
      const fContent = fs.readFileSync(path.resolve(PERMISSION_SET_PATH, f), 'utf8')
      const fJson = await parseXml(fContent)

      if (fJson.PermissionSet.fieldPermissions) {
        fJson.PermissionSet.fieldPermissions = fJson.PermissionSet.fieldPermissions.filter(x => {
          return (x.readable && x.readable[0] === 'true') || (x.editable && x.editable[0] === 'true')
        })
      }

      fs.writeFileSync(path.resolve(PERMISSION_SET_PATH, f), buildXml(fJson) + '\n')
    })
    .map(x => _(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
