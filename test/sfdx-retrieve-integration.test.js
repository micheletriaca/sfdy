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

const connector = {
  sessionId: `sfdx-test-${Date.now()}`,
  describeMetadata: async () => ({
    metadataObjects: [{
      directoryName: 'objects',
      inFolder: 'false',
      metaFile: 'false',
      suffix: 'object',
      xmlName: 'CustomObject'
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
      await zipMetadata(metadataXml([['Status__c', 'Full retrieve']])),
      connector,
      pkg('CustomObject', 'Invoice__c'),
      adapter
    )

    assert.strictEqual(fs.existsSync(path.join(fieldsFolder, 'Amount__c.field-meta.xml')), false)
    assert.match(await fs.promises.readFile(path.join(fieldsFolder, 'Status__c.field-meta.xml'), 'utf8'), /Full retrieve/)
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
