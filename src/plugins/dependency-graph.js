module.exports = async (context, helpers) => {
  helpers.requireMetadata(['Profile/*', 'PermissionSet/*'], async ({ filterPackage }) => filterPackage([
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
  ]))

  helpers.requireMetadata('CustomObjectTranslation/*', async ({ filterPackage }) => filterPackage([
    'CustomObject',
    'CustomField',
    'Layout'
  ]))
}
