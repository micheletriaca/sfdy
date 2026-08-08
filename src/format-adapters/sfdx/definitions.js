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
        type: 'CustomField',
        xmlTag: 'fields',
        directory: 'fields',
        suffix: 'field-meta.xml'
      }
    ]
  }
}
