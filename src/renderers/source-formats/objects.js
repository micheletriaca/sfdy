module.exports = {
  useChildXml: true, // if true, the specific child xml metadata are inserted in generated package.xml
  folderName: 'objects',
  objName: 'CustomObject',
  suffix: '.object',
  split: [
    ['fields', 'field', 'CustomField'],
    ['recordTypes', 'recordType', 'RecordType'],
    ['listViews', 'listView', 'ListView'],
    ['compactLayouts', 'compactLayout', 'CompactLayout'],
    ['validationRules', 'validationRule', 'ValidationRule'],
    ['webLinks', 'webLink', 'WebLink'],
    ['businessProcesses', 'businessProcess', 'BusinessProcess'],
    ['fieldSets', 'fieldSet', 'FieldSet'],
    ['sharingReasons', 'sharingReason', 'SharingReason']
  ]
}
