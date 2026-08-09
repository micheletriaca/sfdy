const multimatch = require('multimatch')
const chalk = require('chalk')
const _ = require('lodash')
const { remapProfileName, retrieveAllObjects, getVersionedObjects } = require('./utils')
const get = require('lodash').get
const { definePlugin } = require('../../plugin')
const { transformXml } = require('../v2-utils')

module.exports = definePlugin({
  name: 'core-add-profile-object-permissions',
  stage: 'metadata',

  enabled: ({ files, config }) => {
    const extraObjects = get(config, 'profiles.addExtraObjects', [])
    return (extraObjects.length > 0 || !!get(config, 'profiles.addDisabledVersionedObjects')) &&
      files.match('profiles/**/*').length > 0
  },

  async onRetrieve ({ files, project, config, salesforce, log }) {
    const extraObjectsGlob = get(config, 'profiles.addExtraObjects', [])
    const services = {
      query: _.memoize(salesforce.query.bind(salesforce)),
      salesforce
    }
    const retrieveObjects = _.memoize(group => retrieveAllObjects(group, services))
    const versionedObjects = getVersionedObjects(project.match('objects/**/*'))
    const allObjectsPerLicense = await retrieveObjects('license')

    await transformXml(files, 'profiles/**/*', async (fJson, file) => {
      const isCustom = fJson.custom && fJson.custom[0] === 'true'
      if (!isCustom) return
      log.info(chalk.blue(`----> Processing ${file.path}: Adding objects`))
      const allObjects = allObjectsPerLicense.Salesforce
        .filter(b => {
          const x = b.SobjectType
          if (versionedObjects.has(x)) return true
          else return multimatch(x, extraObjectsGlob).length > 0
        })

      const profileRealName = await remapProfileName(file.path, services)
      const currentProfileObjectData = (await retrieveObjects('profile'))[profileRealName] || []
      const currentProfileObjectDataMap = _.keyBy(currentProfileObjectData, 'SobjectType')
      const currentProfileObjects = new Set(_.map(currentProfileObjectData, 'SobjectType'))
      const extraObjects = allObjects.filter(x => !versionedObjects.has(x.SobjectType))
      const missingVersionedObjects = allObjects.filter(x => !currentProfileObjects.has(x.SobjectType) && versionedObjects.has(x.SobjectType))
      const finalPermissions = {
        ..._(!get(config, 'profiles.addDisabledVersionedObjects') ? [] : missingVersionedObjects)
          .map(obj => ({
            allowCreate: false,
            allowDelete: false,
            allowEdit: false,
            allowRead: false,
            modifyAllRecords: false,
            object: obj.SobjectType,
            viewAllRecords: false
          }))
          .keyBy('object')
          .value(),
        ..._(extraObjects)
          .map(obj => {
            const o = currentProfileObjects.has(obj.SobjectType) ? currentProfileObjectDataMap[obj.SobjectType] : {}
            return {
              allowCreate: !!o.PermissionsCreate,
              allowDelete: !!o.PermissionsDelete,
              allowEdit: !!o.PermissionsEdit,
              allowRead: !!o.PermissionsRead,
              modifyAllRecords: !!o.PermissionsModifyAllRecords,
              object: [obj.SobjectType],
              viewAllRecords: !!o.PermissionsViewAllRecords
            }
          })
          .keyBy('object')
          .value(),
        ..._(fJson.objectPermissions || [])
          .filter(x => versionedObjects.has(x.object[0]))
          .keyBy(x => x.object[0])
          .value()
      }

      fJson.objectPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      const disabledObjects = new Set(_(fJson.objectPermissions)
        .filter(x => Object.entries(x).every(([k, v]) => {
          v = Array.isArray(v) ? v : [v]
          return k === 'object' || v[0] === 'false' || !v[0]
        }))
        .map(x => Array.isArray(x.object) ? x.object[0] : x.object)
        .value())
      if (fJson.fieldPermissions) {
        fJson.fieldPermissions = fJson.fieldPermissions.filter(x => !disabledObjects.has(x.field[0].split('.')[0]))
      }
      log.info(chalk.blue('----> Done'))
    })
  }
})
