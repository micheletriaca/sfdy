const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buffer } = require('stream/consumers')
const yauzl = require('yauzl')
const deploy = require('../src/deploy')
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

const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>65.0</version>
</Package>\n`

const fieldXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Status__c</fullName>
    <label>Status</label>
    <type>Text</type>
</CustomField>\n`

;(async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const originalNewInstance = Sfdc.newInstance
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-sfdx-deploy-'))
  const sourceFolder = path.join(basePath, 'src')
  let deployedZip

  try {
    await fs.promises.mkdir(path.join(sourceFolder, 'objects', 'Invoice__c', 'fields'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'permissionsets'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'lwc', 'tile'), { recursive: true })
    await fs.promises.writeFile(path.join(sourceFolder, 'package.xml'), packageXml)
    await fs.promises.writeFile(path.join(sourceFolder, 'objects', 'Invoice__c', 'fields', 'Status__c.field-meta.xml'), fieldXml)
    await fs.promises.writeFile(path.join(sourceFolder, 'permissionsets', 'Admin.permissionset-meta.xml'), '<PermissionSet/>')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.js'), 'export default class Tile {}')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.html'), '<template></template>')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.js-meta.xml'), '<LightningComponentBundle/>')

    Sfdc.newInstance = async () => ({
      sessionId: `sfdx-deploy-test-${Date.now()}`,
      username: 'test@example.com',
      describeMetadata: async () => ({
        metadataObjects: [{
          directoryName: 'objects',
          inFolder: 'false',
          metaFile: 'false',
          suffix: 'object',
          xmlName: 'CustomObject'
        }, {
          directoryName: 'permissionsets',
          inFolder: 'false',
          metaFile: 'false',
          suffix: 'permissionset',
          xmlName: 'PermissionSet'
        }, {
          directoryName: 'lwc',
          inFolder: 'false',
          metaFile: 'false',
          xmlName: 'LightningComponentBundle'
        }]
      }),
      deployMetadata: async stream => {
        deployedZip = await buffer(stream)
        return { id: '0Af-test' }
      },
      pollDeployMetadataStatus: async () => ({
        status: 'Succeeded',
        checkOnly: 'false',
        details: {}
      })
    })

    const runDeploy = (files, preDeployPlugins = []) => deploy({
      basePath,
      config: { sourceFormat: 'sfdx' },
      files,
      loginOpts: { username: 'test@example.com', password: 'secret' },
      logger: () => {},
      preDeployPlugins
    })

    await runDeploy('objects/Invoice__c/fields/Status__c.field-meta.xml', [async (...pluginArgs) => {
      const helpers = pluginArgs[1]
      helpers.xmlTransformer('objects/*.object', async (...transformArgs) => {
        const objectXml = transformArgs[1]
        objectXml.fields[0].label = ['Patched by plugin']
      })
    }])

    const entries = await unzip(deployedZip)
    const entryMap = new Map(entries.map(item => [item.fileName, item.data]))
    assert.deepStrictEqual([...entryMap.keys()].sort(), ['objects/Invoice__c.object', 'package.xml'])

    const objectXml = await parseXml(entryMap.get('objects/Invoice__c.object'))
    assert.deepStrictEqual(objectXml.CustomObject.fields.map(field => field.fullName[0]), ['Status__c'])
    assert.deepStrictEqual(objectXml.CustomObject.fields[0].label, ['Patched by plugin'])

    const manifest = await parseXml(entryMap.get('package.xml'))
    assert.strictEqual(manifest.Package.types[0].name[0], 'CustomField')
    assert.deepStrictEqual(manifest.Package.types[0].members, ['Invoice__c.Status__c'])

    await runDeploy('permissionsets/Admin.permissionset-meta.xml')
    const permissionSetEntries = await unzip(deployedZip)
    assert.deepStrictEqual(permissionSetEntries.map(item => item.fileName).sort(), [
      'package.xml',
      'permissionsets/Admin.permissionset'
    ])
    const permissionSetManifest = await parseXml(permissionSetEntries.find(item => item.fileName === 'package.xml').data)
    assert.strictEqual(permissionSetManifest.Package.types[0].name[0], 'PermissionSet')
    assert.deepStrictEqual(permissionSetManifest.Package.types[0].members, ['Admin'])

    await runDeploy('lwc/tile/tile.js')
    const bundleEntries = await unzip(deployedZip)
    assert.deepStrictEqual(bundleEntries.map(item => item.fileName).sort(), [
      'lwc/tile/tile.html',
      'lwc/tile/tile.js',
      'lwc/tile/tile.js-meta.xml',
      'package.xml'
    ])
    const bundleManifest = await parseXml(bundleEntries.find(item => item.fileName === 'package.xml').data)
    assert.strictEqual(bundleManifest.Package.types[0].name[0], 'LightningComponentBundle')
    assert.deepStrictEqual(bundleManifest.Package.types[0].members, ['tile'])

    await runDeploy('lwc/tile')
    const directoryEntries = await unzip(deployedZip)
    assert.deepStrictEqual(directoryEntries.map(item => item.fileName).sort(), bundleEntries.map(item => item.fileName).sort())
    console.log('SFDX deploy integration tests passed')
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
