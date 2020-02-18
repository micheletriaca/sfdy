const path = require('path')
let basePath = process.cwd()

module.exports = {
  setBasePath: p => (basePath = p),
  getBasePath: () => basePath,
  getProfilePath: () => path.resolve(basePath, 'src/profiles'),
  getTranslationsPath: () => path.resolve(basePath, 'src/objectTranslations'),
  getObjectPath: () => path.resolve(basePath, 'src/objects'),
  getTabsPath: () => path.resolve(basePath, 'src/tabs'),
  getPermissionSetPath: () => path.resolve(basePath, 'src/permissionsets'),
  getRolesPath: () => path.resolve(basePath, 'src/roles'),
  getPackagePath: () => path.resolve(basePath, 'src', 'package.xml')
}
