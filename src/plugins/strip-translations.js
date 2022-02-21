const _ = require('exstream.js')
const isPluginEnabled = _.makeGetter('config.objectTranslations.stripUntranslatedFields', false)

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

const fixTranslations = async xmlTransformer => {
  await xmlTransformer(['translations/**/*'], async (filename, fJson) => {
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
}

const fixStdValueSetTranslations = async xmlTransformer => {
  await xmlTransformer(['standardValueSetTranslations/**/*'], async (filename, fJson) => {
    processXml(fJson, { valueTranslation: 'translation' })
  })
}

const fixObjectTranslations = async xmlTransformer => {
  await xmlTransformer(['objectTranslations/**/*'], async (filename, fJson) => {
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

module.exports = {
  afterRetrieve: async (ctx, { xmlTransformer }) => {
    if (!isPluginEnabled(ctx)) return
    await fixTranslations(xmlTransformer)
    await fixStdValueSetTranslations(xmlTransformer)
    await fixObjectTranslations(xmlTransformer)
  }
}
