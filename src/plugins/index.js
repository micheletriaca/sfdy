module.exports = [
  require('./profile-plugins/add-application-visibilities-to-profiles'),
  require('./dependency-graph'),
  require('./strip-unversioned-stuff'),
  require('./profile-plugins/add-tab-visibilities-to-profiles'),
  require('./profile-plugins/add-objects-to-profiles'),
  require('./profile-plugins/add-all-permissions-to-custom-profiles'),
  require('./profile-plugins/strip-immutable-stuff-from-std-profiles'),
  require('./strip-managed-package-stuff'),
  require('./strip-translations'),
  require('./strip-partner-roles')
]
