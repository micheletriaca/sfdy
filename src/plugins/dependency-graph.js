module.exports = {
  beforeRetrieve: async (context, { setMetaCompanions }) => {
    await setMetaCompanions('Profile/*', () => [
      'CustomApplication/*',
      'ApexClass/*',
      'ApexPage/*',
      'CustomObject/*',
      'CustomField/*',
      'RecordType/*',
      'CustomTab/*',
      'CustomPermission/*',
      'Layout/*',
      'DataCategoryGroup/*',
      'ExternalDataSource/*'
    ])

    await setMetaCompanions('CustomObjectTranslation/*', f => {
      const tObject = f.replace(/^[^/]+\/([^-]+)-.*$/, '$1')
      return [
        'CustomObject/' + tObject,
        'CustomField/' + tObject + '*',
        'Layout/' + tObject + '*'
      ]
    })
  }
}
