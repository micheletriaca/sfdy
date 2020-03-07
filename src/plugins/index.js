module.exports = [
  require('./strip-managed-package-stuff'),
  require('./strip-fls-in-permission-sets'),
  require('./profile-plugins/strip-immutable-stuff-from-std-profiles'),
  require('./profile-plugins/add-all-permissions-to-custom-profiles'),
  require('./profile-plugins/add-objects-to-profiles'),
  require('./strip-partner-roles'),
  require('./strip-translations')
]
