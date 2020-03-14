const multimatch = require('multimatch')
const _ = require('lodash')

module.exports = async (context, helpers) => {
  const extraAppsGlob = _.get(context, 'config.profiles.addExtraApplications', [])
  if (!extraAppsGlob.length) return

  helpers.requireMetadata(['Profile/*'], async ({ patchPackage }) => patchPackage([
    'CustomApplication/*'
  ]))

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
    const appsToConsider = (await requireFiles('applications/**/*'))
      .map(x => x.fileName.replace(/^applications\/(.*)\.app$/, '$1'))

    const realGlob = [...extraAppsGlob, ...appsToConsider]
    fJson.applicationVisibilities = (fJson.applicationVisibilities || []).filter(x => {
      return multimatch(x.application[0], realGlob).length > 0
    })
  })
}
