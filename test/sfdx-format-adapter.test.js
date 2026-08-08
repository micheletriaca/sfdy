const assert = require('assert')
const { parseXml } = require('../src/utils/xml-utils')
const adapter = require('../src/format-adapters/sfdx')
const { getAdapter, getFormat } = require('../src/format-adapters')

const xml = value => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${value}\n`)
const entry = (fileName, data) => ({ fileName, data: Buffer.isBuffer(data) ? data : xml(data) })
const byName = entries => new Map(entries.map(item => [item.fileName, item]))

const layout = entry('layouts/Account-Account Layout.layout', `
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
    <layoutSections><label>Information</label></layoutSections>
</Layout>`.trim())

const apexBody = entry('classes/Example.cls', 'public class Example {}\n')
const apexMeta = entry('classes/Example.cls-meta.xml', `
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <status>Active</status>
</ApexClass>`.trim())

const customObject = entry('objects/Invoice__c.object', `
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Invoice</label>
    <businessProcesses><fullName>Retail</fullName></businessProcesses>
    <compactLayouts><fullName>Highlights</fullName></compactLayouts>
    <fieldSets><fullName>Details</fullName></fieldSets>
    <fields>
        <fullName>Amount__c</fullName>
        <label>Amount</label>
        <type>Currency</type>
    </fields>
    <fields>
        <fullName>Status__c</fullName>
        <label>Status</label>
        <type>Text</type>
    </fields>
    <indexes><fullName>ExternalId</fullName></indexes>
    <listViews><fullName>All</fullName></listViews>
    <recordTypes><fullName>Business</fullName></recordTypes>
    <sharingReasons><fullName>Manual</fullName></sharingReasons>
    <validationRules><fullName>AmountRequired</fullName></validationRules>
    <webLinks><fullName>Portal</fullName></webLinks>
    <pluralLabel>Invoices</pluralLabel>
</CustomObject>`.trim())

const objectTranslation = entry('objectTranslations/Invoice__c-it.objectTranslation', `
<CustomObjectTranslation xmlns="http://soap.sforce.com/2006/04/metadata">
    <caseValues><article>Il</article><caseType>Nominative</caseType><plural>false</plural><value>Fattura</value></caseValues>
    <fields><name>Status__c</name><label>Stato</label></fields>
</CustomObjectTranslation>`.trim())

const bot = entry('bots/Help.bot', `
<Bot xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Help</label>
    <botVersions><fullName>v1</fullName><status>Active</status></botVersions>
</Bot>`.trim())

const normalizedXml = async value => JSON.parse(JSON.stringify(await parseXml(value)))

const packageMapping = {
  permissionsets: {
    directoryName: 'permissionsets',
    inFolder: 'false',
    metaFile: 'false',
    suffix: 'permissionset',
    xmlName: 'PermissionSet'
  },
  lwc: {
    directoryName: 'lwc',
    inFolder: 'false',
    metaFile: 'false',
    xmlName: 'LightningComponentBundle'
  },
  experiences: {
    directoryName: 'experiences',
    inFolder: 'false',
    metaFile: 'false',
    xmlName: 'ExperienceBundle'
  },
  reports: [{
    directoryName: 'reports',
    inFolder: 'true',
    metaFile: 'false',
    suffix: 'report',
    xmlName: 'Report'
  }, {
    directoryName: 'reports',
    inFolder: 'false',
    metaFile: 'false',
    suffix: 'reportFolder',
    xmlName: 'ReportFolder'
  }],
  documents: [{
    directoryName: 'documents',
    inFolder: 'true',
    metaFile: 'true',
    suffix: 'document',
    xmlName: 'Document'
  }, {
    directoryName: 'documents',
    inFolder: 'false',
    metaFile: 'false',
    suffix: 'documentFolder',
    xmlName: 'DocumentFolder'
  }]
}

;(async () => {
  assert.strictEqual(getFormat(), 'metadata')
  assert.strictEqual(getFormat({ sourceFormat: 'sfdx' }), 'sfdx')
  assert.strictEqual(getFormat({ sourceFormat: 'sfdx' }, 'mdapi'), 'metadata')
  assert.strictEqual(getAdapter({ sourceFormat: 'SFDX' }), adapter)
  assert.throws(() => getAdapter({ sourceFormat: 'unknown' }), /Unsupported source format/)

  const simpleSource = await adapter.toSource([layout, apexBody, apexMeta])
  assert.deepStrictEqual(simpleSource.deletes, [])
  assert.deepStrictEqual(simpleSource.upserts.map(item => item.fileName), [
    'layouts/Account-Account Layout.layout-meta.xml',
    'classes/Example.cls',
    'classes/Example.cls-meta.xml'
  ])

  const simpleMetadata = await adapter.toMetadata(simpleSource.upserts)
  assert.deepStrictEqual(simpleMetadata.components, [
    { type: 'Layout', fullName: 'Account-Account Layout' },
    { type: 'ApexClass', fullName: 'Example' }
  ])
  assert.deepStrictEqual(simpleMetadata.entries.map(item => item.fileName), [
    'layouts/Account-Account Layout.layout',
    'classes/Example.cls',
    'classes/Example.cls-meta.xml'
  ])
  assert.deepStrictEqual(simpleMetadata.entries.map(item => item.data), [
    layout.data,
    apexBody.data,
    apexMeta.data
  ])

  const fullSource = await adapter.toSource([customObject])
  assert.deepStrictEqual(fullSource.deletes, ['objects/Invoice__c'])
  assert.deepStrictEqual(fullSource.upserts.map(item => item.fileName), [
    'objects/Invoice__c/Invoice__c.object-meta.xml',
    'objects/Invoice__c/businessProcesses/Retail.businessProcess-meta.xml',
    'objects/Invoice__c/compactLayouts/Highlights.compactLayout-meta.xml',
    'objects/Invoice__c/fieldSets/Details.fieldSet-meta.xml',
    'objects/Invoice__c/fields/Amount__c.field-meta.xml',
    'objects/Invoice__c/fields/Status__c.field-meta.xml',
    'objects/Invoice__c/indexes/ExternalId.index-meta.xml',
    'objects/Invoice__c/listViews/All.listView-meta.xml',
    'objects/Invoice__c/recordTypes/Business.recordType-meta.xml',
    'objects/Invoice__c/sharingReasons/Manual.sharingReason-meta.xml',
    'objects/Invoice__c/validationRules/AmountRequired.validationRule-meta.xml',
    'objects/Invoice__c/webLinks/Portal.webLink-meta.xml'
  ])
  const fullSourceMap = byName(fullSource.upserts)
  const objectRoot = await normalizedXml(fullSourceMap.get('objects/Invoice__c/Invoice__c.object-meta.xml').data)
  assert.strictEqual(objectRoot.CustomObject.fields, undefined)
  assert.strictEqual(objectRoot.CustomObject.validationRules, undefined)

  const recomposed = await adapter.toMetadata(fullSource.upserts)
  assert.deepStrictEqual(recomposed.components, [
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'BusinessProcess', fullName: 'Invoice__c.Retail' },
    { type: 'CompactLayout', fullName: 'Invoice__c.Highlights' },
    { type: 'FieldSet', fullName: 'Invoice__c.Details' },
    { type: 'CustomField', fullName: 'Invoice__c.Amount__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' },
    { type: 'Index', fullName: 'Invoice__c.ExternalId' },
    { type: 'ListView', fullName: 'Invoice__c.All' },
    { type: 'RecordType', fullName: 'Invoice__c.Business' },
    { type: 'SharingReason', fullName: 'Invoice__c.Manual' },
    { type: 'ValidationRule', fullName: 'Invoice__c.AmountRequired' },
    { type: 'WebLink', fullName: 'Invoice__c.Portal' }
  ])
  assert.deepStrictEqual(
    await normalizedXml(recomposed.entries[0].data),
    await normalizedXml(customObject.data)
  )

  const selectedField = fullSourceMap.get('objects/Invoice__c/fields/Status__c.field-meta.xml')
  const partialMetadata = await adapter.toMetadata([selectedField])
  assert.deepStrictEqual(partialMetadata.components, [
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' }
  ])

  const partialSource = await adapter.toSource(partialMetadata.entries, {
    components: partialMetadata.components
  })
  assert.deepStrictEqual(partialSource.deletes, [])
  assert.deepStrictEqual(partialSource.upserts.map(item => item.fileName), [
    'objects/Invoice__c/fields/Status__c.field-meta.xml'
  ])
  const partialObject = await normalizedXml(partialMetadata.entries[0].data)
  assert.deepStrictEqual(partialObject.CustomObject.fields.map(field => field.fullName[0]), ['Status__c'])

  const selectedRule = fullSourceMap.get('objects/Invoice__c/validationRules/AmountRequired.validationRule-meta.xml')
  const ruleMetadata = await adapter.toMetadata([selectedRule])
  assert.deepStrictEqual(ruleMetadata.components, [
    { type: 'ValidationRule', fullName: 'Invoice__c.AmountRequired' }
  ])
  const ruleSource = await adapter.toSource(ruleMetadata.entries, { components: ruleMetadata.components })
  assert.deepStrictEqual(ruleSource.deletes, [])
  assert.deepStrictEqual(ruleSource.upserts.map(item => item.fileName), [
    'objects/Invoice__c/validationRules/AmountRequired.validationRule-meta.xml'
  ])

  assert.deepStrictEqual(adapter.resolve([
    'layouts/Account-Account Layout.layout-meta.xml',
    'classes/Example.cls',
    'classes/Example.cls-meta.xml',
    'objects/Invoice__c/Invoice__c.object-meta.xml',
    'objects/Invoice__c/fields/Status__c.field-meta.xml',
    'objects/Invoice__c/validationRules/AmountRequired.validationRule-meta.xml'
  ]), [
    { type: 'Layout', fullName: 'Account-Account Layout' },
    { type: 'ApexClass', fullName: 'Example' },
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' },
    { type: 'ValidationRule', fullName: 'Invoice__c.AmountRequired' }
  ])
  assert.deepStrictEqual(adapter.getCompanionPaths(['classes/Example.cls']), [
    'classes/Example.cls',
    'classes/Example.cls-meta.xml'
  ])
  assert.deepStrictEqual(adapter.getMetadataContainers([
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' },
    { type: 'ValidationRule', fullName: 'Invoice__c.AmountRequired' }
  ]), [
    { type: 'CustomObject', fullName: 'Invoice__c' }
  ])
  assert.deepStrictEqual(adapter.getPackageComponents([
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' },
    { type: 'ValidationRule', fullName: 'Invoice__c.AmountRequired' },
    { type: 'CustomField', fullName: 'Other__c.Status__c' }
  ]), [
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'CustomField', fullName: 'Other__c.Status__c' }
  ])

  const wildcardSource = await adapter.toSource([customObject], {
    components: [{ type: 'CustomField', fullName: '*' }]
  })
  assert.deepStrictEqual(wildcardSource.deletes, [])
  assert.deepStrictEqual(wildcardSource.upserts.map(item => item.fileName), [
    'objects/Invoice__c/fields/Amount__c.field-meta.xml',
    'objects/Invoice__c/fields/Status__c.field-meta.xml'
  ])

  const decomposedSource = await adapter.toSource([objectTranslation, bot])
  assert.deepStrictEqual(decomposedSource.deletes, [
    'objectTranslations/Invoice__c-it',
    'bots/Help'
  ])
  assert.deepStrictEqual(decomposedSource.upserts.map(item => item.fileName), [
    'objectTranslations/Invoice__c-it/Invoice__c-it.objectTranslation-meta.xml',
    'objectTranslations/Invoice__c-it/Status__c.fieldTranslation-meta.xml',
    'bots/Help/Help.bot-meta.xml',
    'bots/Help/v1.botVersion-meta.xml'
  ])
  const recomposedDecomposed = await adapter.toMetadata(decomposedSource.upserts)
  assert.deepStrictEqual(recomposedDecomposed.components, [
    { type: 'CustomObjectTranslation', fullName: 'Invoice__c-it' },
    { type: 'CustomFieldTranslation', fullName: 'Invoice__c-it.Status__c' },
    { type: 'Bot', fullName: 'Help' },
    { type: 'BotVersion', fullName: 'Help.v1' }
  ])
  assert.deepStrictEqual(
    await normalizedXml(recomposedDecomposed.entries[0].data),
    await normalizedXml(objectTranslation.data)
  )
  assert.deepStrictEqual(
    await normalizedXml(recomposedDecomposed.entries[1].data),
    await normalizedXml(bot.data)
  )
  assert.deepStrictEqual(adapter.getPackageComponents([
    { type: 'CustomFieldTranslation', fullName: 'Invoice__c-it.Status__c' },
    { type: 'BotVersion', fullName: 'Help.v1' }
  ]), [
    { type: 'CustomObjectTranslation', fullName: 'Invoice__c-it' },
    { type: 'BotVersion', fullName: 'Help.v1' }
  ])
  assert.deepStrictEqual(adapter.getMetadataContainers([
    { type: 'CustomFieldTranslation', fullName: 'Invoice__c-it.Status__c' },
    { type: 'BotVersion', fullName: 'Help.v1' }
  ]), [
    { type: 'CustomObjectTranslation', fullName: 'Invoice__c-it' },
    { type: 'Bot', fullName: 'Help' }
  ])

  const genericAdapter = adapter.create(packageMapping)
  const genericSource = [
    entry('permissionsets/Admin.permissionset-meta.xml', '<PermissionSet/>'),
    entry('lwc/tile/tile.js', 'export default class {}'),
    entry('lwc/tile/tile.html', '<template/>'),
    entry('lwc/tile/tile.js-meta.xml', '<LightningComponentBundle/>'),
    entry('experiences/Store/routes/home.json', '{}'),
    entry('reports/Sales.reportFolder-meta.xml', '<ReportFolder/>'),
    entry('reports/Sales/Pipeline.report-meta.xml', '<Report/>'),
    entry('documents/Manuals/Guide.pdf', 'pdf'),
    entry('documents/Manuals/Guide.document-meta.xml', '<Document/>'),
    entry('unknown/Thing.unknown-meta.xml', '<Unknown/>')
  ]
  const genericMetadata = await genericAdapter.toMetadata(genericSource)
  assert.deepStrictEqual(genericMetadata.components, [
    { type: 'PermissionSet', fullName: 'Admin' },
    { type: 'LightningComponentBundle', fullName: 'tile' },
    { type: 'ExperienceBundle', fullName: 'Store' },
    { type: 'ReportFolder', fullName: 'Sales' },
    { type: 'Report', fullName: 'Sales/Pipeline' },
    { type: 'Document', fullName: 'Manuals/Guide' }
  ])
  assert.deepStrictEqual(genericMetadata.entries.map(item => item.fileName), [
    'permissionsets/Admin.permissionset',
    'lwc/tile/tile.js',
    'lwc/tile/tile.html',
    'lwc/tile/tile.js-meta.xml',
    'experiences/Store/routes/home.json',
    'reports/Sales-meta.xml',
    'reports/Sales/Pipeline.report',
    'documents/Manuals/Guide.pdf',
    'documents/Manuals/Guide.pdf-meta.xml',
    'unknown/Thing.unknown-meta.xml'
  ])
  assert.deepStrictEqual(genericAdapter.getCompanionPaths(
    ['lwc/tile/tile.js'],
    genericSource.map(item => item.fileName)
  ), [
    'lwc/tile/tile.js',
    'lwc/tile/tile.html',
    'lwc/tile/tile.js-meta.xml'
  ])

  const genericRoundTrip = await genericAdapter.toSource(genericMetadata.entries)
  assert.deepStrictEqual(genericRoundTrip.upserts.map(item => item.fileName), genericSource.map(item => item.fileName))

  console.log('SFDX format adapter tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
