const path = require('path')
let basePath = process.cwd()
let srcFolder = 'src'

module.exports = {
  setBasePath: p => (basePath = p),
  setSrcFolder: p => (srcFolder = p),
  getBasePath: () => basePath,
  getSrcFolder: () => srcFolder,
  getProfilePath: () => path.resolve(basePath, `${srcFolder}/profiles`),
  getObjectTranslationsPath: () => path.resolve(basePath, `${srcFolder}/objectTranslations`),
  getStandardValueSetTranslations: () => path.resolve(basePath, `${srcFolder}/standardValueSetTranslations`),
  getTranslationsPath: () => path.resolve(basePath, `${srcFolder}/translations`),
  getObjectPath: () => path.resolve(basePath, `${srcFolder}/objects`),
  getTabsPath: () => path.resolve(basePath, `${srcFolder}/tabs`),
  getPermissionSetPath: () => path.resolve(basePath, `${srcFolder}/permissionsets`),
  getRolesPath: () => path.resolve(basePath, `${srcFolder}/roles`),
  getPackagePath: () => path.resolve(basePath, srcFolder, 'package.xml')
}
