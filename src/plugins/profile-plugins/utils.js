/* eslint-disable quote-props */
const _ = require('exstream.js')
const memoize = require('lodash/memoize')

const remapProfileName = async (f, ctx) => {
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
  const stdProfiles = await _(ctx.q('SELECT Profile.Name FROM PermissionSet WHERE IsCustom = FALSE AND Profile.Name != NULL'))
    .flatten()
    .filter(x => !pNames.has(x.Profile.Name))
    .map(x => ctx.q(`SELECT FullName, Name FROM Profile WHERE Name = '${x.Profile.Name}' LIMIT 1`, true))
    .resolve(4)
    .reduce((memo, x) => ({ ...memo, [x[0].FullName]: x[0].Name }), fMap)
    .value()

  return stdProfiles[f] || f
}

const retrievePermissionsList = memoize(async (profileName, ctx) => {
  const psetId = (await ctx.q(`SELECT Id FROM PermissionSet Where Profile.Name = '${profileName}'`))[0].Id
  const res = await ctx.sfdc.rest(`/sobjects/PermissionSet/${psetId}`)
  return Object.keys(res)
    .filter(x => x.startsWith('Permissions'))
    .map(x => ({
      enabled: [!!res[x] + ''],
      name: [x.replace(/^Permissions/, '')]
    }))
})

const retrieveAllObjects = memoize(async (byLicenseOrByProfile = 'license', ctx) => {
  return _(ctx.q(`SELECT
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
    .flatten()
    .groupBy(`Parent.${byLicenseOrByProfile === 'license' ? 'License' : 'Profile'}.Name`)
    .mapValues(x => _(x).uniqBy('SobjectType').values())
    .value()
})

const retrieveAllTabVisibilities = async (profile, ctx) => {
  return ctx.sfdc.query(`SELECT
    Id,
    Parent.Profile.Name,
    Visibility,
    Name
    FROM PermissionSetTabSetting
    WHERE Parent.Profile.Name = '${profile}'`
  )
}

const getVersionedObjects = objectFileNames => {
  return new Set(objectFileNames.filter(x => !x.filteredByPlugin).map(x => x.fileName.replace(/^objects\/(.*)\.object$/, '$1')))
}

module.exports = {
  retrieveAllObjects,
  retrievePermissionsList,
  remapProfileName,
  retrieveAllTabVisibilities,
  getVersionedObjects
}
