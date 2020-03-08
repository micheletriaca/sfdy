const multimatch = require('multimatch')
const _ = require('lodash')

module.exports = async (context, helpers, allFiles) => {
  const extraAppsGlob = _.get(context, 'config.profiles.addExtraApplications', [])
  if (!extraAppsGlob.length) return

  const appsToConsider = [
    ...((context.pkg.types.find(x => x.name[0] === 'CustomApplication') || {}).members || [])
  ]
  context.pkg.types = context.pkg.types.filter(x => x.name[0] !== 'CustomApplication')
  context.pkg.types.push({
    members: ['*'],
    name: ['CustomApplication']
  })

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson, allFiles) => {
    const realGlob = [...extraAppsGlob, ...appsToConsider]
    fJson.applicationVisibilities = (fJson.applicationVisibilities || []).filter(x => {
      return multimatch(x.application[0], realGlob).length > 0
    })
  })

  helpers.filterMetadata(fileName => {
    return (
      !fileName.startsWith('applications/') ||
      multimatch(fileName.replace(/^applications\/(.*)\.app$/, '$1'), appsToConsider).length > 0
    )
  })
}
