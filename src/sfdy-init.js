const fs = require('fs')
const path = require('path')
const pathService = require('./services/path-service')
const { program } = require('commander')

program
  .option('--api-version <version>', 'Salesforce Metadata API version')
  .parse(process.argv)

const configPath = path.resolve(pathService.getBasePath(), '.sfdy.json')
const legacyPackagePath = path.resolve(pathService.getBasePath(), 'src', 'package.xml')
const legacyPackage = fs.existsSync(legacyPackagePath) && fs.readFileSync(legacyPackagePath, 'utf8')
const legacyVersion = legacyPackage && legacyPackage.match(/<version>([^<]+)<\/version>/)
const apiVersion = program.opts().apiVersion || (legacyVersion && legacyVersion[1])

fs.writeFileSync(configPath, JSON.stringify({
  sourceFormat: 'metadata',
  ...(apiVersion ? { apiVersion } : {}),
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
  stripManagedPackageFields: [],
  excludeFiles: ['lwc/**/__tests__/**/*']
}, null, 2))

if (!apiVersion) console.warn('Set apiVersion in .sfdy.json before deploying or retrieving metadata')
