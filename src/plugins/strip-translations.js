const { parseXml } = require('../utils/xml-utils')
const memoize = require('lodash').memoize

const getObjectFields = memoize(async (objName, fileMap) => {
  const objectExists = !!fileMap['objects/' + objName]
  const objXml = (objectExists && await parseXml(fileMap['objects/' + objName].data)) || {}
  const res = {}
  for (let i = 0; i < objXml.CustomObject.fields.length; i++) {
    res[objXml.CustomObject.fields[i].fullName[0]] = true
  }
  return res
})

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
  if (context.config.objectTranslations.stripUntranslatedFields) {
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
          { 'picklistValues': 'translation' }
        ],
        'layouts': { 'sections': 'label' },
        'sharingReasons': 'label'
      })
    })
  }

  if (context.config.objectTranslations.stripNotVersionedFields) {
    helpers.xmlTransformer('objectTranslations/**/*', async (filename, fJson, fileMap) => {
      const objName = filename.replace(/.*\//g, '').replace(/-.*/, '') + '.object'
      const objFields = await getObjectFields(objName, fileMap)
      fJson.fields = (fJson.fields || []).filter(x => objFields[x.name[0]])
    })
  }
}
