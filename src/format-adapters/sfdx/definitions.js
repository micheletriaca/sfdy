const XML_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata'

const simpleTypes = [
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
]

// Folder metadata are part of source format, but describeMetadata only exposes
// their contained type (Report, Dashboard, Document, EmailTemplate).
const folderTypes = [
  { type: 'ReportFolder', packageType: 'Report', directory: 'reports', suffix: 'reportFolder', disambiguateMember: true },
  { type: 'DashboardFolder', packageType: 'Dashboard', directory: 'dashboards', suffix: 'dashboardFolder', disambiguateMember: true },
  { type: 'DocumentFolder', packageType: 'Document', directory: 'documents', suffix: 'documentFolder' },
  { type: 'EmailFolder', packageType: 'EmailTemplate', directory: 'email', suffix: 'emailFolder' }
].map(definition => ({
  ...definition,
  inFolder: false,
  metaFile: false
}))

const object = {
  type: 'CustomObject',
  directory: 'objects',
  metadataSuffix: 'object',
  sourceSuffix: 'object-meta.xml',
  decomposition: 'folderPerType',
  sortRootElements: true,
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

const objectTranslation = {
  type: 'CustomObjectTranslation',
  directory: 'objectTranslations',
  metadataSuffix: 'objectTranslation',
  sourceSuffix: 'objectTranslation-meta.xml',
  decomposition: 'topLevel',
  children: [{
    type: 'CustomFieldTranslation',
    xmlTag: 'fields',
    suffix: 'fieldTranslation-meta.xml',
    uniqueIdElement: 'name',
    addressable: false
  }]
}

const bot = {
  type: 'Bot',
  directory: 'bots',
  metadataSuffix: 'bot',
  sourceSuffix: 'bot-meta.xml',
  decomposition: 'topLevel',
  children: [{
    type: 'BotVersion',
    xmlTag: 'botVersions',
    suffix: 'botVersion-meta.xml'
  }]
}

const customLabels = {
  type: 'CustomLabels',
  fullName: 'CustomLabels',
  directory: 'labels',
  metadataSuffix: 'labels',
  sourceSuffix: 'labels-meta.xml',
  children: [{
    type: 'CustomLabel',
    xmlTag: 'labels',
    uniqueIdElement: 'fullName'
  }]
}

module.exports = {
  XML_NAMESPACE,
  simpleTypes,
  folderTypes,
  object,
  decomposedTypes: [object, objectTranslation, bot],
  aggregateTypes: [customLabels]
}
