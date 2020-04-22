const fs = require('fs')
const path = require('path')
const pathService = require('./services/path-service')

const configPath = path.resolve(pathService.getBasePath(), '.sfdy.json')

fs.writeFileSync(configPath, JSON.stringify({
  permissionSets: {
    stripUselessFls: true
  },
  objectTranslations: {
    stripUntranslatedFields: true,
    stripNotVersionedFields: true
  },
  preDeployPlugins: [],
  postRetrievePlugins: [],
  profiles: {
    addAllUserPermissions: true,
    addDisabledVersionedObjects: true,
    addExtraObjects: ['*', '!*__?', '!Account', 'Lead'],
    addExtraTabVisibility: ['*', '!*__?', '!*Account', '*Lead'],
    addExtraApplications: ['*', '!standard__*'],
    stripUserPermissionsFromStandardProfiles: true,
    stripUnversionedStuff: true
  },
  roles: {
    stripPartnerRoles: true
  },
  staticResources: {
    useBundleRenderer: ['*']
  },
  stripManagedPackageFields: []
}, null, 2))
