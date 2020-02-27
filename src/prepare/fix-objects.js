const { parseXml, buildXml } = require('../utils/xml-utils')
const path = require('path')
const fs = require('fs')
const _ = require('highland')
const pathService = require('../services/path-service')

module.exports = async (config) => {
  if (!fs.existsSync(pathService.getObjectPath()) || !config.stripManagedPackageFields) return true
  return _(fs.readdirSync(pathService.getObjectPath()))
    .map(async f => {
      const fContent = fs.readFileSync(path.resolve(pathService.getObjectPath(), f), 'utf8')
      const fJson = await parseXml(fContent)

      if (fJson.CustomObject.fields) {
        fJson.CustomObject.fields = fJson.CustomObject.fields.filter(x => {
          return !config.stripManagedPackageFields.some(mp => {
            return new RegExp(`${mp}__.*`).test(x.fullName[0])
          })
        })
      }

      if (fJson.CustomObject.recordTypes) {
        fJson.CustomObject.recordTypes.forEach(v => {
          if (!v.picklistValues) return
          v.picklistValues = v.picklistValues.filter(x => {
            return !config.stripManagedPackageFields.some(mp => {
              return new RegExp(`${mp}__.*`).test(x.picklist[0])
            })
          })
        })
      }

      if (fJson.CustomObject.webLinks) {
        fJson.CustomObject.webLinks = fJson.CustomObject.webLinks.filter(x => {
          return !config.stripManagedPackageFields.some(mp => {
            return new RegExp(`${mp}__.*`).test(x.fullName[0])
          })
        })
      }

      fs.writeFileSync(path.resolve(pathService.getObjectPath(), f), buildXml(fJson) + '\n')
    })
    .map(x => _(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
