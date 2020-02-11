
const { parseXml, buildXml } = require('../utils/xml-utils')
const path = require('path')
const fs = require('fs')
const _ = require('highland')

const TRANSLATIONS_PATH = path.resolve(process.cwd(), 'src/objectTranslations')
const OBJECTS_PATH = path.resolve(process.cwd(), 'src/objects')

module.exports = async (config) => {
  if (!fs.existsSync(TRANSLATIONS_PATH) || !config.objectTranslations) return true
  const cfg = config.objectTranslations
  return _(fs.readdirSync(TRANSLATIONS_PATH))
    .map(async f => {
      const fContent = fs.readFileSync(path.resolve(TRANSLATIONS_PATH, f), 'utf8')
      const fJson = await parseXml(fContent)

      if (cfg.stripNotVersionedFields) {
        const objName = f.replace(/-.*/, '') + '.object'
        const objPath = path.resolve(OBJECTS_PATH, objName)
        const objectExists = fs.existsSync(objPath)

        const objFields = (
          objectExists
            ? (await parseXml(fs.readFileSync(objPath, 'utf8')))
              .CustomObject
              .fields
              .map(x => x.fullName[0])
              .reduce((res, x) => ({ ...res, [x]: true }), {})
            : {}
        )

        if (fJson.CustomObjectTranslation.fields) {
          fJson.CustomObjectTranslation.fields = fJson.CustomObjectTranslation.fields.filter(x => objFields[x.name[0]])
        }
      }

      if (cfg.stripUntrunslatedFields) {
        const keysToProcess = {
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
          'layouts': { 'sections': 'label' }
        }

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

        processXml(fJson.CustomObjectTranslation, keysToProcess)
      }

      fs.writeFileSync(path.resolve(TRANSLATIONS_PATH, f), buildXml(fJson) + '\n')
    })
    .map(x => _(x))
    .sequence()
    .collect()
    .toPromise(Promise)
}
