const XML_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata'

module.exports = {
  XML_NAMESPACE,
  simpleTypes: [
    {
      type: 'Layout',
      directory: 'layouts',
      metadataSuffix: 'layout',
      sourceSuffix: 'layout-meta.xml'
    },
    {
      type: 'ApexClass',
      directory: 'classes',
      metadataSuffix: 'cls',
      sourceSuffix: 'cls',
      companionSuffix: 'cls-meta.xml'
    }
  ],
  object: {
    type: 'CustomObject',
    directory: 'objects',
    metadataSuffix: 'object',
    sourceSuffix: 'object-meta.xml',
    children: [
      {
        type: 'BusinessProcess',
        xmlTag: 'businessProcesses',
        directory: 'businessProcesses',
        suffix: 'businessProcess-meta.xml'
      },
      {
        type: 'CompactLayout',
        xmlTag: 'compactLayouts',
        directory: 'compactLayouts',
        suffix: 'compactLayout-meta.xml'
      },
      {
        type: 'FieldSet',
        xmlTag: 'fieldSets',
        directory: 'fieldSets',
        suffix: 'fieldSet-meta.xml'
      },
      {
        type: 'CustomField',
        xmlTag: 'fields',
        directory: 'fields',
        suffix: 'field-meta.xml'
      },
      {
        type: 'Index',
        xmlTag: 'indexes',
        directory: 'indexes',
        suffix: 'index-meta.xml'
      },
      {
        type: 'ListView',
        xmlTag: 'listViews',
        directory: 'listViews',
        suffix: 'listView-meta.xml'
      },
      {
        type: 'RecordType',
        xmlTag: 'recordTypes',
        directory: 'recordTypes',
        suffix: 'recordType-meta.xml'
      },
      {
        type: 'SharingReason',
        xmlTag: 'sharingReasons',
        directory: 'sharingReasons',
        suffix: 'sharingReason-meta.xml'
      },
      {
        type: 'ValidationRule',
        xmlTag: 'validationRules',
        directory: 'validationRules',
        suffix: 'validationRule-meta.xml'
      },
      {
        type: 'WebLink',
        xmlTag: 'webLinks',
        directory: 'webLinks',
        suffix: 'webLink-meta.xml'
      }
    ]
  }
}
