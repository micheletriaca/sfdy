const { getFieldMap, getVersionedObjects, getVersionedTabs, getVersionedApplications, mcNamesSpace } = require('../utils/object-utils')
const { parseXml, buildXml } = require('../utils/xml-utils')
const connectionFactory = require('../utils/sfdc-utils')
const pathService = require('../services/path-service')
const multimatch = require('multimatch')
const program = require('commander')
const path = require('path')
const chalk = require('chalk')
const log = require('../services/log-service').getLogger()
const fs = require('fs')
const __ = require('highland')
const _ = require('lodash')

module.exports = async (config, sfConn = undefined) => {
  if (!fs.existsSync(pathService.getProfilePath()) || !config.profiles) return true
  if (!sfConn) {
    sfConn = await connectionFactory.newInstance({
      username: program.username,
      password: program.password,
      isSandbox: !!program.sandbox
    })
  }

  const q = _.memoize(sfConn.query.bind(sfConn))
  const remapProfileName = async f => {
    f = f.replace('.profile', '').split(' ').map(x => decodeURIComponent(x)).join(' ')
    const fMap = {
      'Admin': 'System Administrator',
      'ReadOnly': 'Read Only',
      'Standard': 'Standard User',
      'MarketingProfile': 'Marketing User',
      'ContractManager': 'Contract Manager',
      'SolutionManager': 'Solution Manager',
      'Chatter Free User': 'Chatter Free User',
      'Guest': 'Standard Guest',
      'Chatter External User': 'Chatter External User',
      'Chatter Moderator User': 'Chatter Moderator User',
      'Guest License User': 'Guest License User',
      'StandardAul': 'Standard Platform User'
    }

    const pNames = new Set(Object.values(fMap))
    const stdProfiles = await __(await q('SELECT Profile.Name FROM PermissionSet WHERE IsCustom = FALSE AND Profile.Name != NULL'))
      .filter(x => !pNames.has(x.Profile.Name))
      .map(x => __(q(`SELECT FullName, Name FROM Profile WHERE Name = '${x.Profile.Name}' LIMIT 1`, true)))
      .parallel(4)
      .reduce(fMap, (memo, x) => ({ ...memo, [x[0].FullName]: x[0].Name }))
      .toPromise(Promise)

    return stdProfiles[f] || f
  }
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

  return __(fs.readdirSync(pathService.getProfilePath())).map(async f => {
    log(chalk.cyan(`---> Processing ${f}`))
    const fContent = fs.readFileSync(path.resolve(pathService.getProfilePath(), f), 'utf8')
    const fJson = await parseXml(fContent)
    const isStandard = !fJson.Profile.custom || fJson.Profile.custom[0] !== 'true'

    if (pcfg.stripUserPermissionsFromStandardProfiles && isStandard) {
      log(chalk.grey(`Stripping user permissions...`))
      fJson.Profile.userPermissions = []
      log(chalk.grey('done.'))
    }

    if (pcfg.addAllUserPermissions && (!isStandard || !pcfg.stripUserPermissionsFromStandardProfiles)) {
      log(chalk.grey(`Adding all user permissions...`))
      const allPermissions = await retrievePermissionsList(await remapProfileName(f))

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

      const currentProfileObjectData = (await retrieveAllObjects('profile'))[await remapProfileName(f)] || []
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
              'object': [obj.SobjectType],
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
      const disabledObjects = new Set(_(fJson.Profile.objectPermissions)
        .filter(x => Object.entries(x).every(([k, v]) => k === 'object' || v[0] === 'false' || !v[0]))
        .map(x => x['object'][0])
        .value())
      if (fJson.Profile.fieldPermissions) {
        fJson.Profile.fieldPermissions = fJson.Profile.fieldPermissions.filter(x => !disabledObjects.has(x.field[0].split('.')[0]))
      }
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
          .parallel(10)
          .collect()
          .toPromise(Promise)
      ]
      const versionedTabs = new Set(getVersionedTabs(allTabs))
      const visibleTabs = _.keyBy(await retrieveAllTabVisibilities(await remapProfileName(f)), 'Name')
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

    if (pcfg.stripManagedPackageFields) {
      log(chalk.grey('stripping managed package fields...'))
      fJson.Profile.fieldPermissions = fJson.Profile.fieldPermissions.filter(x => {
        return !pcfg.stripManagedPackageFields.some(mp => {
          return new RegExp(`.*${mp}__.*`).test(x.field[0])
        })
      })
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

    fs.writeFileSync(path.resolve(pathService.getProfilePath(), f), buildXml(fJson) + '\n')
  })
    .map(x => __(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
