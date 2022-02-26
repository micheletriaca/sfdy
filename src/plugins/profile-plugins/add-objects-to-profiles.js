const multimatch = require('multimatch')
const chalk = require('chalk')
const _ = require('exstream.js')
const { remapProfileName, retrieveAllObjects, getVersionedObjects } = require('./utils')
const isExtraObjPluginEnabled = _.makeGetter('profiles.addExtraObjects', false)
const isDisabledVersionedPluginEnabled = _.makeGetter('profiles.addDisabledVersionedObjects', false)
const get = require('lodash/get')
const memoize = require('lodash/memoize')

module.exports = {
  isEnabled: config => {
    const eop = isExtraObjPluginEnabled(config) && !!config.profiles.addExtraObjects.length
    const vop = isDisabledVersionedPluginEnabled(config)
    return vop || eop
  },

  afterRetrieve: async (ctx, { xmlTransformer, getFiles }) => {
    ctx.q = memoize(ctx.sfdc.query)
    const extraObjectsPatterns = get(ctx, 'config.profiles.addExtraObjects', [])

    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      const isCustom = fJson.custom && fJson.custom[0] === 'true'
      if (!isCustom) return
      ctx.log(chalk.blue(`----> Processing ${filename}: Adding objects`))
      const versionedObjects = new Set(getVersionedObjects(await getFiles('objects/**/*')))
      const allObjectsPerLicense = await retrieveAllObjects('license', ctx)
      const allObjects = allObjectsPerLicense.Salesforce
        .filter(b => {
          const x = b.SobjectType
          if (versionedObjects.has(x)) return true
          else return multimatch(x, extraObjectsPatterns).length > 0
        })

      const profileRealName = await remapProfileName(filename, ctx)
      const currentProfileObjectData = (await retrieveAllObjects('profile', ctx))[profileRealName] || []
      const currentProfileObjectDataMap = _(currentProfileObjectData).keyBy('SobjectType').value()
      const currentProfileObjects = new Set(Object.keys(currentProfileObjectDataMap))
      const extraObjects = allObjects.filter(x => !versionedObjects.has(x.SobjectType))
      const missingVersionedObjects = allObjects.filter(x => !currentProfileObjects.has(x.SobjectType) && versionedObjects.has(x.SobjectType))
      const finalPermissions = {}

      if (isDisabledVersionedPluginEnabled(ctx.config)) {
        for (const obj of missingVersionedObjects) {
          finalPermissions[obj.SobjectType] = {
            allowCreate: false,
            allowDelete: false,
            allowEdit: false,
            allowRead: false,
            modifyAllRecords: false,
            object: obj.SobjectType,
            viewAllRecords: false
          }
        }
      }

      for (const obj of extraObjects) {
        const o = currentProfileObjects.has(obj.SobjectType) ? currentProfileObjectDataMap[obj.SobjectType] : {}
        finalPermissions[obj.SobjectType] = {
          allowCreate: !!o.PermissionsCreate,
          allowDelete: !!o.PermissionsDelete,
          allowEdit: !!o.PermissionsEdit,
          allowRead: !!o.PermissionsRead,
          modifyAllRecords: !!o.PermissionsModifyAllRecords,
          object: [obj.SobjectType],
          viewAllRecords: !!o.PermissionsViewAllRecords
        }
      }

      for (const obj of (fJson.objectPermissions || [])) {
        if (versionedObjects.has(obj.object[0])) finalPermissions[obj.object[0]] = obj
      }

      fJson.objectPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      const disabledObjects = _(fJson.objectPermissions)
        .filter(x => Object
          .entries(x)
          .filter(([k]) => k !== 'object')
          .map(([, v]) => Array.isArray(v) ? v[0] : v)
          .every(v => v === 'false' || !v)
        )
        .map(x => Array.isArray(x.object) ? x.object[0] : x.object)
        .toSet()

      if (fJson.fieldPermissions) {
        fJson.fieldPermissions = fJson.fieldPermissions.filter(x => !disabledObjects.has(x.field[0].split('.')[0]))
      }
      ctx.log(chalk.blue('----> Done'))
    })
  }
}
