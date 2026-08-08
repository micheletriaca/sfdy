const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buffer } = require('stream/consumers')
const yazl = require('yazl')
const adapter = require('../src/format-adapters/sfdx')
const pluginEngine = require('../src/plugin-engine')
const pathService = require('../src/services/path-service')
const unzip = require('../src/retrieve/unzipper')

const metadataXml = fields => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Invoice</label>
${fields.map(([name, label]) => `    <fields><fullName>${name}</fullName><label>${label}</label><type>Text</type></fields>`).join('\n')}
</CustomObject>\n`)

const zipMetadata = async data => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(data, 'objects/Invoice__c.object')
  zip.end()
  return buffer(zip.outputStream)
}

const zipLabels = async data => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(data, 'labels/CustomLabels.labels')
  zip.end()
  return buffer(zip.outputStream)
}

const zipBundle = async () => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('export default class Tile {}'), 'lwc/tile/tile.js')
  zip.addBuffer(Buffer.from('<template></template>'), 'lwc/tile/tile.html')
  zip.addBuffer(Buffer.from('<LightningComponentBundle/>'), 'lwc/tile/tile.js-meta.xml')
  zip.end()
  return buffer(zip.outputStream)
}

const connector = {
  sessionId: `sfdx-test-${Date.now()}`,
  describeMetadata: async () => ({
    metadataObjects: [{
      directoryName: 'objects',
      inFolder: 'false',
      metaFile: 'false',
      suffix: 'object',
      xmlName: 'CustomObject'
    }, {
      directoryName: 'labels',
      inFolder: 'false',
      metaFile: 'false',
      suffix: 'labels',
      xmlName: 'CustomLabels'
    }, {
      directoryName: 'lwc',
      inFolder: 'false',
      metaFile: 'false',
      xmlName: 'LightningComponentBundle'
    }]
  })
}

const pkg = (type, member) => ({
  types: [{ name: [type], members: [member] }],
  version: ['65.0']
})

;(async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-sfdx-retrieve-'))
  const objectFolder = path.join(basePath, 'src', 'objects', 'Invoice__c')
  const fieldsFolder = path.join(objectFolder, 'fields')

  try {
    pathService.setBasePath(basePath)
    pathService.setSrcFolder('src')
    await fs.promises.mkdir(fieldsFolder, { recursive: true })
    await fs.promises.writeFile(path.join(objectFolder, 'Invoice__c.object-meta.xml'), '<CustomObject><label>Existing</label></CustomObject>')
    await fs.promises.writeFile(path.join(fieldsFolder, 'Amount__c.field-meta.xml'), '<CustomField><label>Amount</label></CustomField>')
    await fs.promises.writeFile(path.join(fieldsFolder, 'Status__c.field-meta.xml'), '<CustomField><label>Old status</label></CustomField>')

    await pluginEngine.registerPlugins([], connector, 'test@example.com', pkg('CustomField', 'Invoice__c.Status__c'))
    await unzip(
      await zipMetadata(metadataXml([['Status__c', 'New status']])),
      connector,
      pkg('CustomField', 'Invoice__c.Status__c'),
      adapter
    )

    assert.strictEqual(fs.existsSync(path.join(objectFolder, 'Invoice__c.object-meta.xml')), true)
    assert.strictEqual(fs.existsSync(path.join(fieldsFolder, 'Amount__c.field-meta.xml')), true)
    assert.match(await fs.promises.readFile(path.join(fieldsFolder, 'Status__c.field-meta.xml'), 'utf8'), /New status/)

    await pluginEngine.registerPlugins([], connector, 'test@example.com', pkg('CustomObject', 'Invoice__c'))
    await unzip(
      await zipMetadata(metadataXml([['Status__c', 'Ignored by root retrieve']])),
      connector,
      pkg('CustomObject', 'Invoice__c'),
      adapter,
      [{ type: 'CustomObject', fullName: 'Invoice__c', scope: 'root' }]
    )

    assert.match(await fs.promises.readFile(path.join(objectFolder, 'Invoice__c.object-meta.xml'), 'utf8'), /Invoice/)
    assert.strictEqual(fs.existsSync(path.join(fieldsFolder, 'Amount__c.field-meta.xml')), true)
    assert.match(await fs.promises.readFile(path.join(fieldsFolder, 'Status__c.field-meta.xml'), 'utf8'), /New status/)

    await pluginEngine.registerPlugins([], connector, 'test@example.com', pkg('CustomObject', 'Invoice__c'))
    await unzip(
      await zipMetadata(metadataXml([['Status__c', 'Full retrieve']])),
      connector,
      pkg('CustomObject', 'Invoice__c'),
      adapter
    )

    assert.strictEqual(fs.existsSync(path.join(fieldsFolder, 'Amount__c.field-meta.xml')), false)
    assert.match(await fs.promises.readFile(path.join(fieldsFolder, 'Status__c.field-meta.xml'), 'utf8'), /Full retrieve/)

    const labelsFolder = path.join(basePath, 'src', 'labels')
    const labelsPath = path.join(labelsFolder, 'CustomLabels.labels-meta.xml')
    await fs.promises.mkdir(labelsFolder, { recursive: true })
    await fs.promises.writeFile(labelsPath, `
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels><fullName>Updated</fullName><value>Old</value></labels>
    <labels><fullName>Preserved</fullName><value>Keep</value></labels>
</CustomLabels>`)
    await pluginEngine.registerPlugins([], connector, 'test@example.com', pkg('CustomLabel', 'Updated'))
    await unzip(
      await zipLabels(Buffer.from(`
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels><fullName>Updated</fullName><value>New</value></labels>
</CustomLabels>`)),
      connector,
      pkg('CustomLabel', 'Updated'),
      adapter
    )
    const labels = await fs.promises.readFile(labelsPath, 'utf8')
    assert.match(labels, /<value>New<\/value>/)
    assert.match(labels, /<fullName>Preserved<\/fullName>/)

    await pluginEngine.registerPlugins([], connector, 'test@example.com', pkg('LightningComponentBundle', 'tile'))
    await unzip(
      await zipBundle(),
      connector,
      pkg('LightningComponentBundle', 'tile'),
      adapter
    )
    assert.strictEqual(fs.existsSync(path.join(basePath, 'src', 'lwc', 'tile', 'tile.js')), true)
    assert.strictEqual(fs.existsSync(path.join(basePath, 'src', 'lwc', 'tile', 'tile.html')), true)
    assert.strictEqual(fs.existsSync(path.join(basePath, 'src', 'lwc', 'tile', 'tile.js-meta.xml')), true)
    console.log('SFDX retrieve integration tests passed')
  } finally {
    pathService.setBasePath(previousBasePath)
    pathService.setSrcFolder(previousSourceFolder)
    await fs.promises.rm(basePath, { recursive: true, force: true })
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
