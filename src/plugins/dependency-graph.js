const { definePlugin } = require('../plugin')

const profileDependencies = [
  'CustomApplication',
  'ApexClass',
  'ApexPage',
  'CustomObject',
  'CustomField',
  'RecordType',
  'CustomTab',
  'CustomPermission',
  'Layout',
  'DataCategoryGroup',
  'ExternalDataSource'
]

module.exports = definePlugin({
  name: 'core-dependency-graph',
  stage: 'metadata',

  plan ({ selection, inventory }) {
    if (selection.match('Profile/*').length) {
      selection.require(inventory.match(profileDependencies.map(type => `${type}/*`)))
    }
    if (selection.match('CustomObjectTranslation/*').length) {
      selection.require(inventory.match([
        'CustomObject/*',
        'CustomField/*',
        'Layout/*'
      ]))
    }
  }
})
