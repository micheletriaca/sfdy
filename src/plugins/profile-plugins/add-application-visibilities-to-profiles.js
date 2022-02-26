const multimatch = require('multimatch')
const _ = require('exstream.js')
const getExtraAppsGlob = _.makeGetter('profiles.addExtraApplications', [])

module.exports = {
  isEnabled: config => !!getExtraAppsGlob(config).length,

  beforeRetrieve: async (ctx, { setMetaCompanions }) => {
    await setMetaCompanions('Profile/*', () => ['CustomApplication/*'], false)
  },

  afterRetrieve: async (ctx, { xmlTransformer, getFiles, excludeFilesWhen }) => {
    const extraAppsGlob = getExtraAppsGlob(ctx.config)

    await xmlTransformer('profiles/**/*', async (filename, fJson) => {
      const appsToConsider = await _(getFiles('applications/**/*', false, true))
        .flatten()
        .map(x => x.replace(/^applications\/(.*)\.app$/, '$1'))
        .values()

      const realGlob = [...extraAppsGlob, ...appsToConsider]
      excludeFilesWhen(f => /^applications\/[^.]+\.app/.test(f) && !multimatch(f, appsToConsider).length)
      fJson.applicationVisibilities = (fJson.applicationVisibilities || []).filter(x => {
        return multimatch(x.application[0], realGlob).length > 0
      })
    })
  }
}
