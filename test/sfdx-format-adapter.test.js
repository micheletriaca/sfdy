const assert = require('assert')
const { parseXml } = require('../src/utils/xml-utils')
const adapter = require('../src/format-adapters/sfdx')

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
    <pluralLabel>Invoices</pluralLabel>
</CustomObject>`.trim())

const normalizedXml = async value => JSON.parse(JSON.stringify(await parseXml(value)))

;(async () => {
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
    'objects/Invoice__c/fields/Amount__c.field-meta.xml',
    'objects/Invoice__c/fields/Status__c.field-meta.xml'
  ])
  const fullSourceMap = byName(fullSource.upserts)
  const objectRoot = await normalizedXml(fullSourceMap.get('objects/Invoice__c/Invoice__c.object-meta.xml').data)
  assert.strictEqual(objectRoot.CustomObject.fields, undefined)

  const recomposed = await adapter.toMetadata(fullSource.upserts)
  assert.deepStrictEqual(recomposed.components, [
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Amount__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' }
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

  assert.deepStrictEqual(adapter.resolve([
    'layouts/Account-Account Layout.layout-meta.xml',
    'classes/Example.cls',
    'classes/Example.cls-meta.xml',
    'objects/Invoice__c/Invoice__c.object-meta.xml',
    'objects/Invoice__c/fields/Status__c.field-meta.xml'
  ]), [
    { type: 'Layout', fullName: 'Account-Account Layout' },
    { type: 'ApexClass', fullName: 'Example' },
    { type: 'CustomObject', fullName: 'Invoice__c' },
    { type: 'CustomField', fullName: 'Invoice__c.Status__c' }
  ])

  await assert.rejects(
    adapter.toMetadata([entry('unknown/Thing.unknown-meta.xml', '<Unknown/>')]),
    /Unsupported SFDX source path/
  )

  console.log('SFDX format adapter tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
