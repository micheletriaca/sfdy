const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const transformer = require('../src/transformer')
const Sfdc = require('../src/utils/sfdc-utils')
const pathService = require('../src/services/path-service')
const { defineRenderer } = require('../src/plugin')

const objectXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Invoice</label>
</CustomObject>\n`

const fieldXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Status__c</fullName>
    <label>Status</label>
    <type>Text</type>
</CustomField>\n`

;(async () => {
  const originalNewInstance = Sfdc.newInstance
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-sfdx-transformer-'))
  const objectFolder = path.join(basePath, 'src', 'objects', 'Invoice__c')

  try {
    await fs.promises.mkdir(path.join(objectFolder, 'fields'), { recursive: true })
    await fs.promises.writeFile(path.join(objectFolder, 'Invoice__c.object-meta.xml'), objectXml)
    await fs.promises.writeFile(path.join(objectFolder, 'fields', 'Status__c.field-meta.xml'), fieldXml)

    Sfdc.newInstance = async () => ({
      sessionId: `sfdx-transformer-${Date.now()}`,
      username: 'test@example.com',
      describeMetadata: async () => ({
        metadataObjects: [{
          directoryName: 'objects',
          inFolder: 'false',
          metaFile: 'false',
          suffix: 'object',
          xmlName: 'CustomObject'
        }]
      })
    })

    const renderer = defineRenderer({
      name: 'field-label-renderer',
      async onDeploy ({ files }) {
        const file = files.get('objects/Invoice__c/fields/Status__c.field-meta.xml')
        const field = await file.readXml()
        field.label = ['Deploy rendered']
        await file.writeXml(field)
      },
      async onRetrieve ({ files }) {
        const file = files.get('objects/Invoice__c/fields/Status__c.field-meta.xml')
        const field = await file.readXml()
        field.label = ['Stored rendered']
        await file.writeXml(field)
      }
    })
    const config = { sourceFormat: 'sfdx', apiVersion: '65.0', renderers: [renderer] }
    const files = await transformer.untransform({
      basePath,
      config,
      files: 'objects/**/*',
      loginOpts: { sessionId: 'session', instanceHostname: 'example.test', apiVersion: '65.0' },
      renderers: [renderer]
    })
    assert.deepStrictEqual(Object.keys(files), ['objects/Invoice__c.object'])
    assert.match(files['objects/Invoice__c.object'].data.toString(), /<fullName>Status__c<\/fullName>/)
    assert.match(files['objects/Invoice__c.object'].data.toString(), /<label>Deploy rendered<\/label>/)

    await transformer.transform({
      basePath,
      config,
      files: Object.values(files),
      loginOpts: { sessionId: 'session', instanceHostname: 'example.test', apiVersion: '65.0' }
    })
    assert.strictEqual(fs.existsSync(path.join(objectFolder, 'Invoice__c.object-meta.xml')), true)
    assert.match(
      await fs.promises.readFile(path.join(objectFolder, 'fields', 'Status__c.field-meta.xml'), 'utf8'),
      /<label>Stored rendered<\/label>/
    )
    console.log('SFDX transformer integration tests passed')
  } finally {
    Sfdc.newInstance = originalNewInstance
    pathService.setBasePath(previousBasePath)
    pathService.setSrcFolder(previousSourceFolder)
    await fs.promises.rm(basePath, { recursive: true, force: true })
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
