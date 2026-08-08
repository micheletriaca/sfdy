const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buffer } = require('stream/consumers')
const yazl = require('yazl')
const retrieve = require('../src/retrieve')
const Sfdc = require('../src/utils/sfdc-utils')
const pathService = require('../src/services/path-service')

const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>*</members><name>CustomObjectTranslation</name></types>
    <version>65.0</version>
</Package>\n`

const translationXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObjectTranslation xmlns="http://soap.sforce.com/2006/04/metadata">
    <fields><name>Status__c</name><label>Nuovo stato</label></fields>
</CustomObjectTranslation>\n`

const zipTranslation = async () => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(translationXml), 'objectTranslations/Invoice__c-it.objectTranslation')
  zip.end()
  return buffer(zip.outputStream)
}

;(async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const originalNewInstance = Sfdc.newInstance
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-sfdx-retrieve-command-'))
  const translationFolder = path.join(basePath, 'src', 'objectTranslations', 'Invoice__c-it')
  let requestedPackage

  try {
    await fs.promises.mkdir(translationFolder, { recursive: true })
    await fs.promises.writeFile(path.join(basePath, 'src', 'package.xml'), packageXml)
    await fs.promises.writeFile(
      path.join(translationFolder, 'Status__c.fieldTranslation-meta.xml'),
      '<CustomFieldTranslation><name>Status__c</name><label>Vecchio stato</label></CustomFieldTranslation>'
    )
    await fs.promises.writeFile(
      path.join(translationFolder, 'Amount__c.fieldTranslation-meta.xml'),
      '<CustomFieldTranslation><name>Amount__c</name><label>Importo</label></CustomFieldTranslation>'
    )

    const zip = await zipTranslation()
    Sfdc.newInstance = async () => ({
      sessionId: `sfdx-retrieve-command-${Date.now()}`,
      username: 'test@example.com',
      describeMetadata: async () => ({
        metadataObjects: [{
          directoryName: 'objectTranslations',
          inFolder: 'false',
          metaFile: 'false',
          suffix: 'objectTranslation',
          xmlName: 'CustomObjectTranslation'
        }]
      }),
      retrieveMetadata: async pkg => {
        requestedPackage = pkg
        return { id: '09S-test' }
      },
      pollRetrieveMetadataStatus: async () => ({ zipFile: zip.toString('base64') })
    })

    await retrieve({
      basePath,
      config: { sourceFormat: 'sfdx', postRetrievePlugins: [] },
      files: 'objectTranslations/Invoice__c-it/Status__c.fieldTranslation-meta.xml',
      loginOpts: { username: 'test@example.com', password: 'secret' },
      logger: () => {}
    })

    assert.strictEqual(requestedPackage.types[0].name[0], 'CustomObjectTranslation')
    assert.deepStrictEqual(requestedPackage.types[0].members, ['Invoice__c-it'])
    assert.match(
      await fs.promises.readFile(path.join(translationFolder, 'Status__c.fieldTranslation-meta.xml'), 'utf8'),
      /Nuovo stato/
    )
    assert.strictEqual(fs.existsSync(path.join(translationFolder, 'Amount__c.fieldTranslation-meta.xml')), true)
    console.log('SFDX retrieve command integration tests passed')
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
