const _ = require('lodash')
const __ = require('highland')

const remapProfileName = async (f, context) => {
  f = f.replace(/^.*\/(.*)\.profile/, '$1').split(' ').map(x => decodeURIComponent(x)).join(' ')
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
    'StandardAul': 'Standard Platform User',
    'Analytics Cloud Integration User': 'Analytics Cloud Integration User',
    'Analytics Cloud Security User': 'Analytics Cloud Security User',
    'Customer Community Login User': 'Customer Community Login User',
    'Cross Org Data Proxy User': 'Cross Org Data Proxy User',
    'PlatformPortal': 'Authenticated Website',
    'Work%2Ecom Only User': 'Work.com Only User',
    'Customer Portal Manager Custom': 'Customer Portal Manager Custom',
    'Identity User': 'Identity User',
    'Customer Community Plus User': 'Customer Community Plus User',
    'Silver Partner User': 'Silver Partner User',
    'HighVolumePortal': 'High Volume Customer Portal',
    'Gold Partner User': 'Gold Partner User',
    'Customer Portal Manager Standard': 'Customer Portal Manager Standard',
    'Force%2Ecom - App Subscription User': 'Force.com - App Subscription User',
    'Customer Community Plus Login User': 'Customer Community Plus Login User',
    'Partner App Subscription User': 'Partner App Subscription User',
    'External Identity User': 'External Identity User',
    'Partner Community User': 'Partner Community User',
    'Partner Community Login User': 'Partner Community Login User',
    'Customer Community User': 'Customer Community User',
    'Force%2Ecom - Free User': 'Force.com - Free User',
    'High Volume Customer Portal User': 'High Volume Customer Portal User'
  }

  const pNames = new Set(Object.values(fMap))
  const stdProfiles = await __(await context.q('SELECT Profile.Name FROM PermissionSet WHERE IsCustom = FALSE AND Profile.Name != NULL'))
    .filter(x => !pNames.has(x.Profile.Name))
    .map(x => __(context.q(`SELECT FullName, Name FROM Profile WHERE Name = '${x.Profile.Name}' LIMIT 1`, true)))
    .parallel(4)
    .reduce(fMap, (memo, x) => ({ ...memo, [x[0].FullName]: x[0].Name }))
    .toPromise(Promise)

  return stdProfiles[f] || f
}

const retrievePermissionsList = _.memoize(async (profileName, context) => {
  const psetId = (await context.q(`SELECT Id FROM PermissionSet Where Profile.Name = '${profileName}'`))[0].Id
  const res = await context.sfdcConnector.rest(`/sobjects/PermissionSet/${psetId}`)
  return Object.keys(res)
    .filter(x => x.startsWith('Permissions'))
    .map(x => ({
      enabled: res[x],
      name: x.replace(/^Permissions/, '')
    }))
})

const retrieveAllObjects = _.memoize(async (byLicenseOrByProfile = 'license', context) => {
  return _(await context.q(`SELECT
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
})

const retrieveAllTabVisibilities = async (profile, context) => {
  return context.sfdcConnector.query(`SELECT
    Id,
    Parent.Profile.Name,
    Visibility,
    Name
    FROM PermissionSetTabSetting
    WHERE Parent.Profile.Name = '${profile}'`
  )
}

const getVersionedObjects = allFiles => {
  return new Set(Object.keys(allFiles)
    .filter(x => x.startsWith('objects/'))
    .map(x => x.replace(/^objects\/(.*)\.object$/, '$1')))
}

module.exports = {
  retrieveAllObjects,
  retrievePermissionsList,
  remapProfileName,
  retrieveAllTabVisibilities,
  getVersionedObjects
}
