const multimatch = require('multimatch')
const get = require('lodash/get')

module.exports = async (context, { xmlTransformer }) => {
  const extraAppsGlob = get(context, 'config.profiles.addExtraApplications', false)
  if (!extraAppsGlob) return

  helpers.requireMetadata(['Profile/*'], async ({ patchPackage }) => patchPackage([
    'CustomApplication/*'
  ]))

  await xmlTransformer('profiles/**/*', async (filename, fJson) => {
    const appsToConsider = (await requireFiles('applications/**/*'))
      .map(x => x.fileName.replace(/^applications\/(.*)\.app$/, '$1'))

    const realGlob = [...extraAppsGlob, ...appsToConsider]
    fJson.applicationVisibilities = (fJson.applicationVisibilities || []).filter(x => {
      return multimatch(x.application[0], realGlob).length > 0
    })
  })
}
