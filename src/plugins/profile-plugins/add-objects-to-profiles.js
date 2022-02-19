const multimatch = require('multimatch')
const chalk = require('chalk')
const _ = require('exstream.js')
const { remapProfileName, retrieveAllObjects, getVersionedObjects } = require('./utils')
const get = require('lodash').get

module.exports = async (context, { xmlTransformer }) => {
  if (!get(context, 'config.profiles.addExtraObjects') && !get(context, 'config.profiles.addDisabledVersionedObjects')) return
  context.q = _.memoize(context.sfdcConnector.query)
  const extraObjectsGlob = get(context, 'config.profiles.addExtraObjects', [])

  await xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
    const isCustom = fJson.custom && fJson.custom[0] === 'true'
    if (!isCustom) return
    context.log(chalk.blue(`----> Processing ${filename}: Adding objects`))
    const versionedObjects = new Set(getVersionedObjects(await requireFiles('objects/**/*')))
    const allObjectsPerLicense = await retrieveAllObjects('license', context)
    const allObjects = allObjectsPerLicense.Salesforce
      .filter(b => {
        const x = b.SobjectType
        if (versionedObjects.has(x)) return true
        else return multimatch(x, extraObjectsGlob).length > 0
      })

    const profileRealName = await remapProfileName(filename, context)
    const currentProfileObjectData = (await retrieveAllObjects('profile', context))[profileRealName] || []
    const currentProfileObjectDataMap = _.keyBy(currentProfileObjectData, 'SobjectType')
    const currentProfileObjects = new Set(_.map(currentProfileObjectData, 'SobjectType'))
    const extraObjects = allObjects.filter(x => !versionedObjects.has(x.SobjectType))
    const missingVersionedObjects = allObjects.filter(x => !currentProfileObjects.has(x.SobjectType) && versionedObjects.has(x.SobjectType))
    const missingVersionedObjectsList = get(context, 'config.profiles.addDisabledVersionedObjects', false) ? missingVersionedObjects : []
    const finalPermissions = {
      ..._(missingVersionedObjectsList)
        .map(obj => ({
          allowCreate: false,
          allowDelete: false,
          allowEdit: false,
          allowRead: false,
          modifyAllRecords: false,
          object: obj.SobjectType,
          viewAllRecords: false
        }))
        .keyBy(x => x.object)
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
        .keyBy(x => x.object)
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
    context.log(chalk.blue('----> Done'))
  })
}
