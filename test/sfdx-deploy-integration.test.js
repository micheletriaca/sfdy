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
const { definePlugin } = require('../src/plugin')

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
  const sourceFolder = path.join(basePath, 'force-app', 'main', 'default')
  let deployedZip
  let deploymentCount = 0
  let pollCount = 0

  try {
    await fs.promises.mkdir(path.join(sourceFolder, 'objects', 'Invoice__c', 'fields'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'permissionsets'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'lwc', 'tile'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'staticresources', 'App'), { recursive: true })
    await fs.promises.mkdir(path.join(sourceFolder, 'reports'), { recursive: true })
    await fs.promises.writeFile(path.join(basePath, 'sfdx-project.json'), JSON.stringify({
      packageDirectories: [{ path: 'force-app', default: true }],
      sourceApiVersion: '65.0'
    }))
    await fs.promises.writeFile(path.join(sourceFolder, 'objects', 'Invoice__c', 'fields', 'Status__c.field-meta.xml'), fieldXml)
    await fs.promises.writeFile(path.join(sourceFolder, 'permissionsets', 'Admin.permissionset-meta.xml'), '<PermissionSet><label>Initial</label></PermissionSet>')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.js'), 'export default class Tile {}')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.html'), '<template></template>')
    await fs.promises.writeFile(path.join(sourceFolder, 'lwc', 'tile', 'tile.js-meta.xml'), '<LightningComponentBundle/>')
    await fs.promises.writeFile(path.join(sourceFolder, 'staticresources', 'App', 'main.js'), 'console.log("app")')
    await fs.promises.writeFile(path.join(sourceFolder, 'staticresources', 'App.resource-meta.xml'), `
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>application/zip</contentType>
</StaticResource>`)
    await fs.promises.writeFile(
      path.join(sourceFolder, 'reports', 'Sales.reportFolder-meta.xml'),
      '<ReportFolder xmlns="http://soap.sforce.com/2006/04/metadata"><name>Sales</name></ReportFolder>'
    )

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
        }, {
          directoryName: 'reports',
          inFolder: 'true',
          metaFile: 'false',
          suffix: 'report',
          xmlName: 'Report'
        }, {
          directoryName: 'staticresources',
          inFolder: 'false',
          metaFile: 'true',
          suffix: 'resource',
          xmlName: 'StaticResource'
        }]
      }),
      deployMetadata: async stream => {
        deploymentCount++
        deployedZip = await buffer(stream)
        return { id: '0Af-test' }
      },
      pollDeployMetadataStatus: async () => {
        pollCount++
        return {
          status: 'Succeeded',
          checkOnly: 'false',
          details: {}
        }
      }
    })

    const runDeploy = (files, preDeployPlugins = []) => deploy({
      basePath,
      config: {
        sourceFormat: 'sfdx',
        staticResources: { useBundleRenderer: ['*'] }
      },
      files,
      loginOpts: { username: 'test@example.com', password: 'secret' },
      logger: () => {},
      preDeployPlugins
    })

    await runDeploy('objects/Invoice__c/fields/Status__c.field-meta.xml', [definePlugin({
      name: 'patch-field',
      async onDeploy ({ files }) {
        const file = files.get('objects/Invoice__c/fields/Status__c.field-meta.xml')
        const field = await file.readXml()
        field.label = ['Patched by plugin']
        await file.writeXml(field)
      }
    })])

    const entries = await unzip(deployedZip)
    const entryMap = new Map(entries.map(item => [item.fileName, item.data]))
    assert.deepStrictEqual([...entryMap.keys()].sort(), ['objects/Invoice__c.object', 'package.xml'])

    const objectXml = await parseXml(entryMap.get('objects/Invoice__c.object'))
    assert.deepStrictEqual(objectXml.CustomObject.fields.map(field => field.fullName[0]), ['Status__c'])
    assert.deepStrictEqual(objectXml.CustomObject.fields[0].label, ['Patched by plugin'])

    const manifest = await parseXml(entryMap.get('package.xml'))
    assert.strictEqual(manifest.Package.types[0].name[0], 'CustomField')
    assert.deepStrictEqual(manifest.Package.types[0].members, ['Invoice__c.Status__c'])

    await runDeploy('objects/Invoice__c/fields/Status__c.field-meta.xml', [definePlugin({
      name: 'patch-metadata-stage-field',
      stage: 'metadata',
      async onDeploy ({ files }) {
        const file = files.get('objects/Invoice__c.object')
        const object = await file.readXml()
        object.fields[0].label = ['Patched after adapter']
        await file.writeXml(object)
      }
    })])
    const metadataStageEntries = await unzip(deployedZip)
    const metadataStageObject = await parseXml(
      metadataStageEntries.find(item => item.fileName === 'objects/Invoice__c.object').data
    )
    assert.deepStrictEqual(metadataStageObject.CustomObject.fields[0].label, ['Patched after adapter'])
    const metadataStageManifest = await parseXml(
      metadataStageEntries.find(item => item.fileName === 'package.xml').data
    )
    assert.strictEqual(metadataStageManifest.Package.types[0].name[0], 'CustomField')

    let legacyCalled = false
    await runDeploy('permissionsets/Admin.permissionset-meta.xml', [async (context, helpers) => {
      helpers.xmlTransformer('permissionsets/**/*', (fileName, permissionSet) => {
        legacyCalled = true
        permissionSet.label = [`Legacy ${context.environment || 'plugin'}`]
      })
    }])
    assert.strictEqual(legacyCalled, true)
    const permissionSetEntries = await unzip(deployedZip)
    assert.deepStrictEqual(permissionSetEntries.map(item => item.fileName).sort(), [
      'package.xml',
      'permissionsets/Admin.permissionset'
    ])
    const permissionSetManifest = await parseXml(permissionSetEntries.find(item => item.fileName === 'package.xml').data)
    assert.strictEqual(permissionSetManifest.Package.types[0].name[0], 'PermissionSet')
    assert.deepStrictEqual(permissionSetManifest.Package.types[0].members, ['Admin'])
    const permissionSet = await parseXml(permissionSetEntries.find(item => item.fileName === 'permissionsets/Admin.permissionset').data)
    assert.deepStrictEqual(permissionSet.PermissionSet.label, ['Legacy plugin'])

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

    await runDeploy('staticresources/App/main.js')
    const staticEntries = await unzip(deployedZip)
    assert.deepStrictEqual(staticEntries.map(item => item.fileName).sort(), [
      'package.xml',
      'staticresources/App.resource',
      'staticresources/App.resource-meta.xml'
    ])
    const staticManifest = await parseXml(staticEntries.find(item => item.fileName === 'package.xml').data)
    assert.strictEqual(staticManifest.Package.types[0].name[0], 'StaticResource')
    assert.deepStrictEqual(staticManifest.Package.types[0].members, ['App'])

    await runDeploy('reports/Sales.reportFolder-meta.xml')
    const reportFolderEntries = await unzip(deployedZip)
    assert.deepStrictEqual(reportFolderEntries.map(item => item.fileName).sort(), [
      'package.xml',
      'reports/Sales-meta.xml'
    ])
    const reportFolderManifest = await parseXml(
      reportFolderEntries.find(item => item.fileName === 'package.xml').data
    )
    assert.strictEqual(reportFolderManifest.Package.types[0].name[0], 'Report')
    assert.deepStrictEqual(reportFolderManifest.Package.types[0].members, ['Sales/'])

    const deploymentsBeforeEmptyDelta = deploymentCount
    const pollsBeforeEmptyDelta = pollCount
    const skipped = await runDeploy('classes/Missing.cls')
    assert.deepStrictEqual(skipped, { status: 'Succeeded', skipped: true })
    assert.strictEqual(deploymentCount, deploymentsBeforeEmptyDelta)
    assert.strictEqual(pollCount, pollsBeforeEmptyDelta)
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
