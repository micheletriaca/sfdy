const get = require('lodash').get

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

module.exports = async (context, helpers) => {
  if (get(context, 'config.objectTranslations.stripUntranslatedFields')) {
    helpers.xmlTransformer('translations/**/*', async (filename, fJson) => {
      processXml(fJson, {
        'reportTypes': [
          'label',
          'description',
          { 'sections': 'label' }
        ],
        'customApplications': 'label',
        'customLabels': 'label',
        'customTabs': 'label'
      })
    })

    helpers.xmlTransformer('standardValueSetTranslations/**/*', async (filename, fJson) => {
      processXml(fJson, { 'valueTranslation': 'translation' })
    })

    helpers.xmlTransformer('objectTranslations/**/*', async (filename, fJson) => {
      processXml(fJson, {
        'validationRules': 'errorMessage',
        'webLinks': 'label',
        'recordTypes': [
          'label',
          'description'
        ],
        'quickActions': 'label',
        'fields': [
          'help',
          'label',
          'relationshipLabel',
          { 'picklistValues': 'translation' },
          { 'lookupFilter': 'errorMessage' }
        ],
        'layouts': { 'sections': 'label' },
        'sharingReasons': 'label'
      })
    })
  }
}
