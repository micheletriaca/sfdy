module.exports = {
  beforeRetrieve: async (ctx, { setMetaCompanions }) => {
    if (ctx.config.profileStrategy === 'fullRetrieve') {
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
    } else if (ctx.config.profileStrategy === 'merge') {
      // TODO -> IN QUESTO CASO NON SONO COMPANIONS, VANNO PROPRIO AGGIUNTI
      await setMetaCompanions([
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
      ], () => ['Profile/*'])
    }

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
