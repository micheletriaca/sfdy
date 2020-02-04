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
    addAllUserPermissions: true,
    addDisabledVersionedObjects: true,
    addExtraObjects: ['*', '!*__?', '!Account', 'Lead'],
    addHiddenVersionedTabVisibilities: true,
    addExtraTabVisibility: ['*', '!*__?', '!*Account', '*Lead'],
    addExtraApplications: ['*', '!standard__*'],
    stripUserPermissionsFromStandardProfiles: true,
    stripUnversionedFields: true
  },
  roles: {
    stripPartnerRoles: true
  }
}, null, 2))
