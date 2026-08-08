const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buffer } = require('stream/consumers')
const yauzl = require('yauzl')
const yazl = require('yazl')
const deploy = require('../src/deploy')
const retrieve = require('../src/retrieve')
const Sfdc = require('../src/utils/sfdc-utils')
const pathService = require('../src/services/path-service')
const { parseXml } = require('../src/utils/xml-utils')

const unzip = zipBuffer => new Promise((resolve, reject) => {
  yauzl.fromBuffer(zipBuffer, { lazyEntries: false }, (error, zipFile) => {
    if (error) return reject(error)
    const reads = []
    zipFile.on('entry', zipEntry => {
      if (zipEntry.fileName.endsWith('/')) return
      reads.push(new Promise((resolve, reject) => {
        zipFile.openReadStream(zipEntry, async (streamError, stream) => {
          if (streamError) return reject(streamError)
          try {
            resolve({ fileName: zipEntry.fileName, data: await buffer(stream) })
          } catch (readError) {
            reject(readError)
          }
        })
      }))
    })
    zipFile.on('end', () => Promise.all(reads).then(resolve, reject))
    zipFile.on('error', reject)
  })
})

const retrievedZip = async () => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('public class Example { public static String value = \'remote\'; }\n'), 'classes/Example.cls')
  zip.addBuffer(Buffer.from('<ApexClass><apiVersion>65.0</apiVersion><status>Active</status></ApexClass>'), 'classes/Example.cls-meta.xml')
  zip.end()
  return buffer(zip.outputStream)
}

const retrievedFieldZip = async () => {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(`
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <fields><fullName>Status__c</fullName><label>Remote status</label><type>Text</type></fields>
</CustomObject>`), 'objects/Invoice__c.object')
  zip.end()
  return buffer(zip.outputStream)
}

;(async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const originalNewInstance = Sfdc.newInstance
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-metadata-manifestless-'))
  const classFolder = path.join(basePath, 'src', 'classes')
  const objectFolder = path.join(basePath, 'src', 'objects')
  let deployedZip
  let requestedPackage

  try {
    await fs.promises.mkdir(classFolder, { recursive: true })
    await fs.promises.mkdir(objectFolder, { recursive: true })
    await fs.promises.writeFile(path.join(classFolder, 'Example.cls'), 'public class Example {}\n')
    await fs.promises.writeFile(
      path.join(classFolder, 'Example.cls-meta.xml'),
      '<ApexClass><apiVersion>65.0</apiVersion><status>Active</status></ApexClass>'
    )
    const zip = await retrievedZip()
    const fieldZip = await retrievedFieldZip()
    Sfdc.newInstance = async options => {
      assert.strictEqual(options.apiVersion, '65.0')
      return {
        sessionId: `metadata-manifestless-${Date.now()}`,
        username: 'test@example.com',
        describeMetadata: async () => ({
          metadataObjects: [
            {
              directoryName: 'classes',
              inFolder: 'false',
              metaFile: 'true',
              suffix: 'cls',
              xmlName: 'ApexClass'
            },
            {
              childXmlNames: ['CustomField', 'ValidationRule'],
              directoryName: 'objects',
              inFolder: 'false',
              metaFile: 'false',
              suffix: 'object',
              xmlName: 'CustomObject'
            }
          ]
        }),
        deployMetadata: async stream => {
          deployedZip = await buffer(stream)
          return { id: '0Af-test' }
        },
        pollDeployMetadataStatus: async () => ({
          status: 'Succeeded',
          checkOnly: 'false',
          details: {}
        }),
        retrieveMetadata: async pkg => {
          requestedPackage = pkg
          return { id: '09S-test' }
        },
        pollRetrieveMetadataStatus: async () => ({
          zipFile: (requestedPackage.types[0].name[0] === 'CustomField' ? fieldZip : zip).toString('base64')
        })
      }
    }

    const options = {
      basePath,
      config: { apiVersion: '65.0' },
      loginOpts: { username: 'test@example.com', password: 'secret' },
      logger: () => {}
    }
    await deploy(options)
    const entries = await unzip(deployedZip)
    assert.deepStrictEqual(entries.map(item => item.fileName).sort(), [
      'classes/Example.cls',
      'classes/Example.cls-meta.xml',
      'package.xml'
    ])
    const deployedPackage = await parseXml(entries.find(item => item.fileName === 'package.xml').data)
    assert.strictEqual(deployedPackage.Package.types[0].name[0], 'ApexClass')
    assert.deepStrictEqual(deployedPackage.Package.types[0].members, ['Example'])

    await retrieve(options)
    assert.strictEqual(requestedPackage.types[0].name[0], 'ApexClass')
    assert.deepStrictEqual(requestedPackage.types[0].members, ['Example'])
    assert.match(await fs.promises.readFile(path.join(classFolder, 'Example.cls'), 'utf8'), /remote/)
    assert.strictEqual(fs.existsSync(path.join(basePath, 'src', 'package.xml')), false)

    await fs.promises.writeFile(path.join(objectFolder, 'Invoice__c.object'), `
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Invoice</label>
    <fields><fullName>Amount__c</fullName><label>Amount</label><type>Currency</type></fields>
    <fields><fullName>Status__c</fullName><label>Local status</label><type>Text</type></fields>
    <validationRules><fullName>RequiredAmount</fullName><active>true</active></validationRules>
</CustomObject>`)
    await retrieve({ ...options, meta: 'CustomField/Invoice__c.Status__c' })
    assert.strictEqual(requestedPackage.types[0].name[0], 'CustomField')
    assert.deepStrictEqual(requestedPackage.types[0].members, ['Invoice__c.Status__c'])
    const mergedObject = await parseXml(await fs.promises.readFile(path.join(objectFolder, 'Invoice__c.object')))
    assert.deepStrictEqual(mergedObject.CustomObject.fields.map(field => [
      field.fullName[0],
      field.label[0]
    ]), [
      ['Amount__c', 'Amount'],
      ['Status__c', 'Remote status']
    ])
    assert.strictEqual(mergedObject.CustomObject.validationRules[0].fullName[0], 'RequiredAmount')
    console.log('Manifestless metadata integration tests passed')
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
