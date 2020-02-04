const { getFieldMap, getVersionedObjects, getVersionedTabs, getVersionedApplications } = require('../utils/object-utils')
const { parseXml, buildXml } = require('../utils/xml-utils')
const connectionFactory = require('../utils/sfdc-utils')
const multimatch = require('multimatch')
const program = require('commander')
const path = require('path')
const chalk = require('chalk')
const log = console.log
const fs = require('fs')
const __ = require('highland')
const _ = require('lodash')

const PROFILE_PATH = path.resolve(process.cwd(), 'src/profiles')

module.exports = async (config, sfConn = undefined) => {
  if (!fs.existsSync(PROFILE_PATH) || !config.profiles) return true
  if (!sfConn) {
    sfConn = await connectionFactory.newInstance({
      username: program.username,
      password: program.password,
      isSandbox: !!program.sandbox
    })
  }

  const q = _.memoize(sfConn.query.bind(sfConn))
  const retrievePermissionsList = _.memoize(async (profileName) => {
    const psetId = (await q(`SELECT Id FROM PermissionSet Where Profile.Name = '${profileName}'`))[0].Id
    const res = await sfConn.rest(`/sobjects/PermissionSet/${psetId}`)
    return Object.keys(res)
      .filter(x => x.startsWith('Permissions'))
      .map(x => ({
        enabled: res[x],
        name: x.replace(/^Permissions/, '')
      }))
  })
  const retrieveAllObjects = _.memoize(async (byLicenseOrByProfile = 'license') => _(await q(`SELECT 
    Id, 
    Parent.Profile.Name,
    Parent.License.Name,
    SobjectType,
    PermissionsCreate,
    PermissionsDelete,
    PermissionsEdit,
    PermissionsModifyAllRecords,
    PermissionsRead,
    PermissionsViewAllRecords
    FROM ObjectPermissions
    WHERE Parent.IsOwnedByProfile = TRUE
    AND Parent.IsCustom = ${byLicenseOrByProfile !== 'license'}`
  ))
    .groupBy(`Parent.${byLicenseOrByProfile === 'license' ? 'License' : 'Profile'}.Name`)
    .mapValues(x => _(x).uniqBy('SobjectType').value())
    .value()
  )
  const retrieveAllTabVisibilities = _.memoize(async (profile) => q(`SELECT
    Id,
    Parent.Profile.Name,
    Visibility,
    Name
    FROM PermissionSetTabSetting
    WHERE Parent.Profile.Name = '${profile}'`
  ))

  const pcfg = config.profiles
  const versionedObjects = new Set(getVersionedObjects())

  return __(fs.readdirSync(PROFILE_PATH)).map(async f => {
    log(chalk.grey(`---> Processing ${f}`))
    const fContent = fs.readFileSync(path.resolve(PROFILE_PATH, f), 'utf8')
    const fJson = await parseXml(fContent)

    if (pcfg.stripUserPermissionsFromStandardProfiles && (!fJson.Profile.custom || fJson.Profile.custom[0] !== 'true')) {
      log(chalk.grey(`Stripping user permissions...`))
      fJson.Profile.userPermissions = []
      log(chalk.grey('done.'))
    }

    if (pcfg.addDisabledUserPermissions) {
      log(chalk.grey(`Adding disabled user permissions...`))
      const allPermissions = await retrievePermissionsList(f.replace('.profile', ''))

      const finalPermissions = {
        ..._.keyBy(allPermissions, 'name')
      }

      fJson.Profile.userPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      log(chalk.grey('done.'))
    }

    if (pcfg.addExtraObjects || pcfg.addDisabledVersionedObjects) {
      log(chalk.grey(`Adding extra objects and disabled versioned objects...`))
      const allObjects = (await retrieveAllObjects('license'))['Salesforce']
        .filter(b => {
          const x = b.SobjectType
          if (versionedObjects.has(x)) return true
          else return multimatch(x, pcfg.addExtraObjects || []).length > 0
        })

      const currentProfileObjectData = (await retrieveAllObjects('profile'))[f.replace('.profile', '')] || []
      const currentProfileObjectDataMap = _.keyBy(currentProfileObjectData, 'SobjectType')
      const currentProfileObjects = new Set(_.map(currentProfileObjectData, 'SobjectType'))

      const extraObjects = allObjects.filter(x => !versionedObjects.has(x))
      const missingVersionedObjects = allObjects.filter(x => !currentProfileObjects.has(x) && versionedObjects.has(x))
      const finalPermissions = {
        ..._(!pcfg.addDisabledVersionedObjects ? [] : missingVersionedObjects)
          .map(obj => ({
            allowCreate: false,
            allowDelete: false,
            allowEdit: false,
            allowRead: false,
            modifyAllRecords: false,
            'object': obj.SobjectType,
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
              'object': obj.SobjectType,
              viewAllRecords: !!o.PermissionsViewAllRecords
            }
          })
          .keyBy('object')
          .value(),
        ..._(fJson.Profile.objectPermissions || [])
          .filter(x => versionedObjects.has(x['object'][0]))
          .keyBy(x => x['object'][0])
          .value()
      }

      fJson.Profile.objectPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      log(chalk.grey('done.'))
    }

    if (pcfg.addExtraTabVisibility || pcfg.addVersionedTabVisibilities) {
      log(chalk.grey('adding extra tabs visibility...'))
      const allTabs = [
        ...await q('SELECT Name, SobjectName FROM TabDefinition ORDER BY Name'),
        ...await __(await q('SELECT Id, Type, DeveloperName FROM CustomTab', true))
          .map(async x => {
            if (x.Type === 'customObject') {
              const y = (await q(`SELECT FullName FROM CustomTab WHERE Id = '${x.Id}'`, true))[0]
              return { Name: y.FullName, SobjectName: y.FullName }
            } else if (x.DeveloperName) {
              return { Name: x.DeveloperName, SobjectName: '' }
            }
          })
          .map(x => __(x))
          .sequence()
          .collect()
          .toPromise(Promise)
      ]
      const versionedTabs = new Set(getVersionedTabs(allTabs))
      const visibleTabs = _.keyBy(await retrieveAllTabVisibilities(f.replace('.profile', '')), 'Name')
      const tabVisibilities = allTabs
        .filter(b => {
          if (pcfg.addVersionedTabVisibilities && (versionedTabs.has(b.Name) || versionedObjects.has(b.SobjectName))) return true
          else return multimatch(b.Name, pcfg.addExtraTabVisibility || []).length > 0
        })
      const finalTabs = {
        ..._(tabVisibilities)
          .map(tab => ({
            tab: tab.Name,
            visibility: (!visibleTabs[tab.Name] && 'Hidden') || visibleTabs[tab.Name].Visibility
          }))
          .keyBy('tab')
          .value(),
        ..._(fJson.Profile.tabVisibilities || [])
          .filter(x => versionedTabs.has(x['tab'][0]))
          .keyBy(x => x['tab'][0])
          .value()
      }

      fJson.Profile.tabVisibilities = Object.keys(finalTabs).sort().map(x => finalTabs[x])
      log(chalk.grey('done.'))
    }

    if (pcfg.stripUnversionedFields) {
      log(chalk.grey('stripping unversioned fields...'))
      const fieldMap = await getFieldMap()
      fJson.Profile.fieldPermissions = fJson.Profile.fieldPermissions.filter(x => fieldMap.has(x.field[0]))
      log(chalk.grey('done.'))
    }

    if (pcfg.addExtraApplications) {
      log(chalk.grey('adding extra application visibilities...'))
      const versionedApps = await getVersionedApplications()
      fJson.Profile.applicationVisibilities = fJson.Profile.applicationVisibilities
        .filter(x => {
          if (multimatch(x.application[0], versionedApps).length > 0) return true
          else return multimatch(x.application[0], pcfg.addExtraApplications).length > 0
        })
      log(chalk.grey('done.'))
    }

    fs.writeFileSync(path.resolve(PROFILE_PATH, f), buildXml(fJson) + '\n')
  })
    .map(x => __(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
