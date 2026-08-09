const multimatch = require('multimatch')
const _ = require('lodash')
const { definePlugin } = require('../../plugin')
const { transformXml } = require('../v2-utils')

module.exports = definePlugin({
  name: 'core-add-profile-application-visibilities',
  stage: 'metadata',

  plan ({ selection, config }) {
    const extraAppsGlob = _.get(config, 'profiles.addExtraApplications', [])
    if (extraAppsGlob.length && selection.match('Profile/*').length) {
      selection.require({ type: 'CustomApplication', fullName: '*' })
    }
  },

  async onRetrieve ({ files, project, config }) {
    const extraAppsGlob = _.get(config, 'profiles.addExtraApplications', [])
    if (!extraAppsGlob.length) return
    const appsToConsider = project.match('applications/**/*')
      .map(file => file.path.replace(/^applications\/(.*)\.app$/, '$1'))

    const realGlob = [...extraAppsGlob, ...appsToConsider]
    await transformXml(files, 'profiles/**/*', fJson => {
      fJson.applicationVisibilities = (fJson.applicationVisibilities || []).filter(x => {
        return multimatch(x.application[0], realGlob).length > 0
      })
    })
  }
})
