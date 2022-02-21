const _ = require('exstream.js')
const memoize = require('lodash').memoize
const chalk = require('chalk')
const { remapProfileName, retrievePermissionsList } = require('./utils')
const isPluginEnabled = _.makeGetter('config.profiles.addAllUserPermissions', false)

module.exports = {
  afterRetrieve: async (ctx, { xmlTransformer }) => {
    if (!isPluginEnabled(ctx)) return
    ctx.q = memoize(ctx.sfdc.query)

    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      const isCustom = fJson.custom && fJson.custom[0] === 'true'
      if (isCustom) {
        ctx.log(chalk.blue(`----> Processing ${filename}: Adding all permissions`))
        ctx.log(chalk.grey('Remapping profile name...'))
        const realProfileName = await remapProfileName(filename, ctx)
        ctx.log(chalk.grey('Retrieving permission list...'))
        const allPermissions = await retrievePermissionsList(realProfileName, ctx)
        ctx.log(chalk.grey('Patching profile...'))
        const finalPermissions = _(allPermissions).keyBy('name').value()
        fJson.userPermissions = Object.keys(finalPermissions).sort().map(x => finalPermissions[x])
        ctx.log(chalk.blue('----> Done'))
      }
    })
  }
}
