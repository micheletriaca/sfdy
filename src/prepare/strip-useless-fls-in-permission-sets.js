
const { mcNamesSpace } = require('../utils/object-utils')
const { parseXml, buildXml } = require('../utils/xml-utils')
const path = require('path')
const fs = require('fs')
const _ = require('highland')
const pathService = require('../services/path-service')

module.exports = async (config) => {
  if (!fs.existsSync(pathService.getPermissionSetPath()) || !config.permissionSets) return true
  return _(fs.readdirSync(pathService.getPermissionSetPath()))
    .map(async f => {
      const fContent = fs.readFileSync(path.resolve(pathService.getPermissionSetPath(), f), 'utf8')
      const fJson = await parseXml(fContent)

      if (config.permissionSets.stripUselessFls && fJson.PermissionSet.fieldPermissions) {
        fJson.PermissionSet.fieldPermissions = fJson.PermissionSet.fieldPermissions.filter(x => {
          return (x.readable && x.readable[0] === 'true') || (x.editable && x.editable[0] === 'true')
        })
      }

      if (config.permissionSets.stripMcFields && fJson.PermissionSet.fieldPermissions) {
        const mcPattern = new RegExp(`.*${mcNamesSpace}.*`)
        fJson.PermissionSet.fieldPermissions = fJson.PermissionSet.fieldPermissions.filter(x => !mcPattern.test(x.field[0]))
      }

      fs.writeFileSync(path.resolve(pathService.getPermissionSetPath(), f), buildXml(fJson) + '\n')
    })
    .map(x => _(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
