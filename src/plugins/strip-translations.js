const get = require('lodash').get
const { definePlugin } = require('../plugin')
const { transformXml } = require('./v2-utils')

const processXml = (root, keysToProcess) => {
  return Object.keys(keysToProcess).reduce((filterIt, key) => {
    if (!root[key]) return true
    root[key] = root[key].filter(x => {
      const labelKeys = Array.isArray(keysToProcess[key]) ? keysToProcess[key] : [keysToProcess[key]]
      return !labelKeys.reduce((filterIt, labelKey) => {
        if (typeof (labelKey) === 'object') return processXml(x, labelKey) && filterIt
        const labelKeyIsNotTranslated = !x[labelKey] || !x[labelKey][0]
        if (labelKeyIsNotTranslated) delete x[labelKey]
        return filterIt && labelKeyIsNotTranslated
      }, true)
    })
    return filterIt && !root[key].length
  }, true)
}

module.exports = definePlugin({
  name: 'core-strip-untranslated-content',
  stage: 'metadata',

  async onRetrieve ({ files, config }) {
    if (get(config, 'objectTranslations.stripUntranslatedFields')) {
      await transformXml(files, 'translations/**/*', fJson => {
        processXml(fJson, {
          reportTypes: [
            'label',
            'description',
            { sections: 'label' }
          ],
          customApplications: 'label',
          customLabels: 'label',
          customTabs: 'label'
        })
      })

      await transformXml(files, 'standardValueSetTranslations/**/*', fJson => {
        processXml(fJson, { valueTranslation: 'translation' })
      })

      await transformXml(files, 'objectTranslations/**/*', fJson => {
        processXml(fJson, {
          validationRules: 'errorMessage',
          webLinks: 'label',
          recordTypes: [
            'label',
            'description'
          ],
          quickActions: 'label',
          fields: [
            'help',
            'label',
            'relationshipLabel',
            { picklistValues: 'translation' },
            { lookupFilter: 'errorMessage' }
          ],
          layouts: { sections: 'label' },
          sharingReasons: 'label'
        })
      })
    }
  }
})
