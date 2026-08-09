const _ = require('lodash')
const chalk = require('chalk')
const { remapProfileName, retrievePermissionsList } = require('./utils')
const get = require('lodash').get
const { definePlugin } = require('../../plugin')
const { transformXml } = require('../v2-utils')

module.exports = definePlugin({
  name: 'core-add-all-custom-profile-permissions',
  stage: 'metadata',

  async onRetrieve ({ files, config, salesforce, log }) {
    if (!get(config, 'profiles.addAllUserPermissions')) return
    const services = {
      query: _.memoize(salesforce.query.bind(salesforce)),
      salesforce
    }
    const permissionsFor = _.memoize(profileName => retrievePermissionsList(profileName, services))
    await transformXml(files, 'profiles/**/*', async (fJson, file) => {
      const isCustom = fJson.custom && fJson.custom[0] === 'true'
      if (!isCustom) return
      log.info(chalk.blue(`----> Processing ${file.path}: Adding all permissions`))
      log.info(chalk.grey('Remapping profile name...'))
      const realProfileName = await remapProfileName(file.path, services)
      log.info(chalk.grey('Retrieving permission list...'))
      const allPermissions = await permissionsFor(realProfileName)
      log.info(chalk.grey('Patching profile...'))
      const finalPermissions = { ..._.keyBy(allPermissions, 'name') }
      fJson.userPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      log.info(chalk.blue('----> Done'))
    })
  }
})
