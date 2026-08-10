const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const convert = require('../src/convert')
const { defineRenderer } = require('../src/plugin')

const classMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <status>Active</status>
</ApexClass>
`

const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>*</members><name>ApexClass</name></types>
    <version>65.0</version>
</Package>
`

const staticResourceMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Private</cacheControl>
    <contentType>application/zip</contentType>
</StaticResource>
`

const append = async (files, value) => {
  const file = files.get('classes/Example.cls')
  file.writeText(`${await file.readText()}\n// ${value}`)
}

;(async () => {
  const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-convert-'))
  const sourceRoot = path.join(basePath, 'src')
  const calls = []
  const connector = {
    sessionId: `convert-${Date.now()}-${Math.random()}`,
    username: 'test@example.com',
    describeMetadata: async () => ({
      metadataObjects: [{
        directoryName: 'classes',
        inFolder: 'false',
        metaFile: 'true',
        suffix: 'cls',
        xmlName: 'ApexClass'
      }, {
        directoryName: 'staticresources',
        inFolder: 'false',
        metaFile: 'true',
        suffix: 'resource',
        xmlName: 'StaticResource'
      }]
    })
  }
  const metadataRenderer = defineRenderer({
    name: 'metadata-renderer',
    formats: ['metadata'],
    async onDeploy ({ files }) {
      calls.push('metadata:deploy')
      await append(files, 'metadata deploy')
    },
    async onRetrieve ({ files, config }) {
      assert.strictEqual(config.sourceFormat, 'metadata')
      calls.push('metadata:retrieve')
      await append(files, 'metadata retrieve')
    }
  })
  const sourceRenderer = defineRenderer({
    name: 'source-renderer',
    formats: ['sfdx'],
    async onDeploy ({ files }) {
      calls.push('sfdx:deploy')
      await append(files, 'source deploy')
    },
    async onRetrieve ({ files, config }) {
      assert.strictEqual(config.sourceFormat, 'sfdx')
      calls.push('sfdx:retrieve')
      await append(files, 'source retrieve')
    }
  })

  try {
    await fs.promises.mkdir(path.join(sourceRoot, 'classes'), { recursive: true })
    await fs.promises.writeFile(path.join(sourceRoot, 'classes', 'Example.cls'), 'public class Example {}')
    await fs.promises.writeFile(path.join(sourceRoot, 'classes', 'Example.cls-meta.xml'), classMetadata)
    await fs.promises.mkdir(path.join(sourceRoot, 'staticresources', 'App'), { recursive: true })
    await fs.promises.writeFile(path.join(sourceRoot, 'staticresources', 'App', 'main.js'), 'console.log("app")')
    await fs.promises.writeFile(
      path.join(sourceRoot, 'staticresources', 'App.resource-meta.xml'),
      staticResourceMetadata
    )
    await fs.promises.writeFile(path.join(sourceRoot, 'package.xml'), packageXml)
    await fs.promises.writeFile(path.join(basePath, '.sfdy.json'), JSON.stringify({
      sourceFormat: 'metadata',
      sourceFolder: 'src',
      apiVersion: '65.0'
    }))

    const sourceResult = await convert({
      basePath,
      config: {
        stored: true,
        sourceFormat: 'metadata',
        sourceFolder: 'src',
        apiVersion: '65.0',
        staticResources: { useBundleRenderer: ['*'] },
        renderers: [metadataRenderer, sourceRenderer]
      },
      sfdcConnector: connector
    })
    assert.strictEqual(sourceResult.sourceFormat, 'sfdx')
    assert.deepStrictEqual(calls, ['metadata:deploy', 'sfdx:retrieve'])
    assert.strictEqual(fs.existsSync(path.join(sourceRoot, 'package.xml')), false)
    assert.match(await fs.promises.readFile(path.join(sourceRoot, 'classes', 'Example.cls'), 'utf8'), /metadata deploy/)
    assert.match(await fs.promises.readFile(path.join(sourceRoot, 'classes', 'Example.cls'), 'utf8'), /source retrieve/)
    assert.strictEqual(fs.existsSync(path.join(sourceRoot, 'staticresources', 'App.resource')), false)
    assert.strictEqual(
      await fs.promises.readFile(path.join(sourceRoot, 'staticresources', 'App', 'main.js'), 'utf8'),
      'console.log("app")'
    )
    assert.deepStrictEqual(JSON.parse(await fs.promises.readFile(path.join(basePath, 'sfdx-project.json'), 'utf8')), {
      namespace: '',
      packageDirectories: [{ path: 'src', default: true }],
      sourceApiVersion: '65.0'
    })
    const storedSourceConfig = JSON.parse(await fs.promises.readFile(path.join(basePath, '.sfdy.json'), 'utf8'))
    assert.strictEqual(storedSourceConfig.sourceFormat, 'sfdx')
    assert.strictEqual(storedSourceConfig.sourceFolder, 'src')
    assert.strictEqual(storedSourceConfig.stored, undefined)
    assert.strictEqual(storedSourceConfig.renderers, undefined)

    calls.length = 0
    const metadataResult = await convert({
      basePath,
      config: {
        sourceFormat: 'sfdx',
        sourceFolder: 'src',
        apiVersion: '65.0',
        staticResources: { useBundleRenderer: ['*'] },
        renderers: [metadataRenderer, sourceRenderer]
      },
      sfdcConnector: connector,
      targetFormat: 'mdapi'
    })
    assert.strictEqual(metadataResult.sourceFormat, 'metadata')
    assert.deepStrictEqual(calls, ['sfdx:deploy', 'metadata:retrieve'])
    const convertedBody = await fs.promises.readFile(path.join(sourceRoot, 'classes', 'Example.cls'), 'utf8')
    assert.match(convertedBody, /source deploy/)
    assert.match(convertedBody, /metadata retrieve/)
    assert.strictEqual(fs.existsSync(path.join(sourceRoot, 'staticresources', 'App.resource')), false)
    assert.strictEqual(
      await fs.promises.readFile(path.join(sourceRoot, 'staticresources', 'App', 'main.js'), 'utf8'),
      'console.log("app")'
    )
    assert.strictEqual(JSON.parse(await fs.promises.readFile(path.join(basePath, '.sfdy.json'), 'utf8')).sourceFormat, 'metadata')
    assert.throws(() => convert.getTargetFormat('metadata', 'metadata'), /already in metadata format/)
    assert.strictEqual(convert.normalizeTargetFormat('source'), 'sfdx')
  } finally {
    await fs.promises.rm(basePath, { recursive: true, force: true })
  }
  console.log('Project conversion tests passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
