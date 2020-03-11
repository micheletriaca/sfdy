const _ = require('lodash')
const chalk = require('chalk')
const { remapProfileName, retrievePermissionsList } = require('./utils')
const get = require('lodash').get

module.exports = async (context, helpers) => {
  if (!get(context, 'config.profiles.addAllUserPermissions')) return
  context.q = _.memoize(context.sfdcConnector.query)

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson) => {
    const isCustom = fJson.custom && fJson.custom[0] === 'true'
    if (isCustom) {
      context.log(chalk.blue(`----> Processing ${filename}: Adding all permissions`))
      context.log(chalk.grey('Remapping profile name...'))
      const realProfileName = await remapProfileName(filename, context)
      context.log(chalk.grey('Retrieving permission list...'))
      const allPermissions = await retrievePermissionsList(realProfileName, context)
      context.log(chalk.grey('Patching profile...'))
      const finalPermissions = { ..._.keyBy(allPermissions, 'name') }
      fJson.userPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
      context.log(chalk.blue('----> Done'))
    }
  })
}
