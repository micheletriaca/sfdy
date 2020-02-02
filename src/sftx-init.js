const fs = require('fs')
const path = require('path')

const configPath = path.resolve(process.cwd(), '.sftx.json')

fs.writeFileSync(configPath, JSON.stringify({
  permissionSets: {
    stripUselessFls: true
  },
  objectTranslations: {
    stripUntrunslatedFields: true,
    stripNotVersionedFields: true
  },
  profiles: {
    addDisabledUserPermissions: true,
    addExtraObjects: ['*', '!*__?', '!Account', 'Lead'],
    stripUserPermissionsFromStandardProfiles: true,
    stripUnversionedFields: true

    // addUnversionedTabVisibilites: true,
    // defaultVersionedClassAccess: false,
    // defaultVersionedFls: 'rw',
    // defaultVersionedPageAccess: false,
    // defaultVersionedTabVisibilites: 'Hidden'
  },
  roles: {
    stripPartnerRoles: true
  },
  customMetadata: {
    format: 'csv'
  }
}, null, 2))
