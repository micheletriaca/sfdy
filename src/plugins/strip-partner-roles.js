const get = require('lodash').get
const { definePlugin } = require('../plugin')

module.exports = definePlugin({
  name: 'core-strip-partner-roles',
  stage: 'metadata',

  onRetrieve ({ files, config }) {
    if (!get(config, 'roles.stripPartnerRoles')) return
    files.excludeWhere(file => /PartnerUser[0-9]*\.role$/.test(file.path))
  }
})
