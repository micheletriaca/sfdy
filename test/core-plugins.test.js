const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buffer } = require('node:stream/consumers')
const test = require('node:test')
const yazl = require('yazl')
const { FileTree, MetadataCollection, MetadataSelection, definePlugin } = require('sfdy/plugin')
const corePlugins = require('../src/plugins')
const coreRenderers = require('../src/renderers')
const sfdxAdapter = require('../src/format-adapters/sfdx')
const { planExtensions, runExtensions } = require('../src/plugin/runtime')
const unzipRetrieve = require('../src/retrieve/unzipper')
const pathService = require('../src/services/path-service')
const { parseXml } = require('../src/utils/xml-utils')

const entry = (fileName, data) => ({ fileName, data: Buffer.from(data) })
const options = {
  direction: 'retrieve',
  format: 'sfdx',
  target: {},
  config: {},
  sfdcConnector: {}
}

test('all core extensions use API v2 and declare their representation', () => {
  assert.equal(corePlugins.every(plugin => plugin.apiVersion === 2 && plugin.stage === 'metadata'), true)
  assert.equal(coreRenderers.every(renderer => renderer.apiVersion === 2), true)
  assert.deepEqual(coreRenderers[0].formats, ['metadata'])
})

test('core planning retrieves dependencies without adding them to output', async () => {
  const selection = new MetadataSelection([{ type: 'Profile', fullName: 'Admin' }])
  const inventory = new MetadataCollection([
    { type: 'ApexClass', fullName: 'Example' },
    { type: 'CustomObject', fullName: 'Invoice__c' }
  ])
  await planExtensions({
    ...options,
    extensions: corePlugins,
    selection,
    inventory,
    config: { profiles: { addExtraApplications: ['*'] } }
  })

  const retrieveTypes = new Map(selection.toPackage().types.map(type => [type.name[0], type.members]))
  assert.deepEqual(retrieveTypes.get('ApexClass'), ['Example'])
  assert.deepEqual(retrieveTypes.get('CustomObject'), ['Invoice__c'])
  assert.deepEqual(retrieveTypes.get('CustomApplication'), ['*'])
  assert.deepEqual(selection.toOutputPackage().types, [{ name: ['Profile'], members: ['Admin'] }])
})

test('runtime executes extensions only at their configured stage', async () => {
  const calls = []
  const metadataPlugin = definePlugin({
    name: 'metadata-stage',
    stage: 'metadata',
    onRetrieve: () => calls.push('metadata')
  })
  const projectPlugin = definePlugin({
    name: 'project-stage',
    onRetrieve: () => calls.push('project')
  })
  const fileTree = new FileTree()

  await runExtensions({ ...options, extensions: [metadataPlugin, projectPlugin], fileTree, stage: 'metadata' })
  await runExtensions({ ...options, extensions: [metadataPlugin, projectPlugin], fileTree, stage: 'project' })
  assert.deepEqual(calls, ['metadata', 'project'])
})

test('enabled skips an extension before its hooks and is evaluated once per phase', async () => {
  const calls = []
  const disabled = definePlugin({
    name: 'disabled',
    enabled: () => {
      calls.push('disabled.enabled')
      return false
    },
    run: () => calls.push('disabled.run'),
    onRetrieve: () => calls.push('disabled.retrieve')
  })
  const enabled = definePlugin({
    name: 'enabled',
    enabled: async ({ config }) => {
      calls.push('enabled.enabled')
      return config.active
    },
    run: () => calls.push('enabled.run'),
    onRetrieve: () => calls.push('enabled.retrieve')
  })

  await runExtensions({
    ...options,
    extensions: [disabled, enabled],
    fileTree: new FileTree(),
    config: { active: true }
  })

  assert.deepEqual(calls, [
    'disabled.enabled',
    'enabled.enabled',
    'enabled.run',
    'enabled.retrieve'
  ])
})

test('profile plugins do not query Salesforce when no profiles were retrieved', async () => {
  let queries = 0
  const fileTree = new FileTree({
    files: [entry('classes/Example.cls', 'public class Example {}')]
  })

  await runExtensions({
    ...options,
    extensions: corePlugins,
    fileTree,
    stage: 'metadata',
    config: {
      profiles: {
        addDisabledVersionedObjects: true,
        addExtraObjects: ['*'],
        addExtraTabVisibility: ['*']
      }
    },
    sfdcConnector: {
      query: async () => {
        queries++
        return []
      }
    }
  })

  assert.equal(queries, 0)
})

test('disabled profile patches do not query Salesforce when profiles were retrieved', async () => {
  let queries = 0
  const fileTree = new FileTree({
    files: [entry('profiles/Admin.profile', '<Profile><custom>true</custom></Profile>')]
  })

  await runExtensions({
    ...options,
    extensions: corePlugins,
    fileTree,
    stage: 'metadata',
    config: {
      profiles: {
        addAllUserPermissions: false,
        addDisabledVersionedObjects: false,
        addExtraObjects: [],
        addExtraTabVisibility: []
      }
    },
    sfdcConnector: {
      query: async () => {
        queries++
        return []
      },
      rest: async () => {
        queries++
        return {}
      }
    }
  })

  assert.equal(queries, 0)
})

test('adding disabled object permissions preserves field permissions', async () => {
  const addObjectPermissions = corePlugins.find(plugin => plugin.name === 'core-add-profile-object-permissions')
  const tree = new FileTree({
    files: [
      entry('objects/Invoice__c.object', '<CustomObject/>'),
      entry('profiles/Custom.profile', `
        <Profile>
          <custom>true</custom>
          <fieldPermissions>
            <editable>false</editable>
            <field>Invoice__c.Reference__c</field>
            <readable>true</readable>
          </fieldPermissions>
        </Profile>`)
    ]
  })

  await runExtensions({
    ...options,
    extensions: [addObjectPermissions],
    fileTree: tree,
    stage: 'metadata',
    config: { profiles: { addDisabledVersionedObjects: true } },
    sfdcConnector: {
      query: async soql => {
        if (soql.includes('Profile.Name FROM PermissionSet')) return []
        if (soql.includes('Parent.IsCustom = true')) return []
        return [{
          Parent: { License: { Name: 'Salesforce' } },
          SobjectType: 'Invoice__c'
        }]
      }
    }
  })

  const profile = await tree.files.get('profiles/Custom.profile').readXml()
  assert.deepEqual(profile.fieldPermissions, [{
    editable: ['false'],
    field: ['Invoice__c.Reference__c'],
    readable: ['true']
  }])
  assert.deepEqual(profile.objectPermissions.map(permission => permission.object), ['Invoice__c'])
})

test('core metadata plugins transform raw metadata through the v2 file API', async () => {
  const tree = new FileTree({
    files: [
      entry('objects/Invoice__c.object', `
        <CustomObject>
          <fields><fullName>pkg__Managed__c</fullName></fields>
          <fields><fullName>Local__c</fullName></fields>
        </CustomObject>`),
      entry('profiles/Admin.profile', `
        <Profile>
          <fieldPermissions><field>pkg__Invoice__c.pkg__Managed__c</field><readable>true</readable></fieldPermissions>
          <fieldPermissions><field>Invoice__c.Local__c</field><readable>true</readable></fieldPermissions>
        </Profile>`)
    ]
  })

  await runExtensions({
    ...options,
    extensions: corePlugins,
    fileTree: tree,
    stage: 'metadata',
    config: { stripManagedPackageFields: ['pkg__'] }
  })

  const object = await tree.files.get('objects/Invoice__c.object').readXml()
  const profile = await tree.files.get('profiles/Admin.profile').readXml()
  assert.deepEqual(object.fields.map(field => field.fullName[0]), ['Local__c'])
  assert.deepEqual(profile.fieldPermissions.map(permission => permission.field[0]), ['Invoice__c.Local__c'])
})

test('metadata-only core renderer is ignored in SFDX projects', async () => {
  const tree = new FileTree({
    files: [entry(
      'staticresources/App.resource-meta.xml',
      '<StaticResource><contentType>application/zip</contentType></StaticResource>'
    )]
  })
  await runExtensions({
    ...options,
    extensions: coreRenderers,
    fileTree: tree,
    config: { staticResources: { useBundleRenderer: ['*'] } }
  })
  assert.deepEqual(tree.entries().map(file => file.fileName), ['staticresources/App.resource-meta.xml'])
})

test('retrieve runs core plugins before the adapter and discards required-only metadata', async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-core-retrieve-'))
  const archive = new yazl.ZipFile()
  archive.addBuffer(Buffer.from(`
    <Profile>
      <fieldPermissions><field>Invoice__c.Valid__c</field><readable>true</readable></fieldPermissions>
      <fieldPermissions><field>Invoice__c.Missing__c</field><readable>true</readable></fieldPermissions>
    </Profile>`), 'profiles/Admin.profile')
  archive.addBuffer(Buffer.from(`
    <CustomObject>
      <fields><fullName>Valid__c</fullName></fields>
    </CustomObject>`), 'objects/Invoice__c.object')
  archive.end()

  const outputPackage = {
    types: [{ name: ['Profile'], members: ['Admin'] }],
    version: ['65.0']
  }
  const retrievePackage = {
    types: [
      ...outputPackage.types,
      { name: ['CustomObject'], members: ['Invoice__c'] }
    ],
    version: ['65.0']
  }
  const connector = {
    sessionId: `core-retrieve-${Date.now()}`,
    username: 'test@example.com',
    describeMetadata: async () => ({
      metadataObjects: [{
        directoryName: 'profiles',
        inFolder: 'false',
        metaFile: 'false',
        suffix: 'profile',
        xmlName: 'Profile'
      }, {
        directoryName: 'objects',
        inFolder: 'false',
        metaFile: 'false',
        suffix: 'object',
        xmlName: 'CustomObject'
      }]
    })
  }

  try {
    pathService.setBasePath(root)
    pathService.setSrcFolder('src')
    await fs.promises.mkdir(path.join(root, 'src'), { recursive: true })
    await unzipRetrieve(
      await buffer(archive.outputStream),
      connector,
      outputPackage,
      null,
      undefined,
      {
        metadataPlugins: corePlugins,
        retrievePackage,
        config: { profiles: { stripUnversionedStuff: true } }
      }
    )

    const profile = await parseXml(await fs.promises.readFile(path.join(root, 'src', 'profiles', 'Admin.profile')))
    assert.deepEqual(
      profile.Profile.fieldPermissions.map(permission => permission.field[0]),
      ['Invoice__c.Valid__c']
    )
    assert.equal(fs.existsSync(path.join(root, 'src', 'objects', 'Invoice__c.object')), false)
  } finally {
    pathService.setBasePath(previousBasePath)
    pathService.setSrcFolder(previousSourceFolder)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('SFDX retrieve keeps metadata-stage dependencies isolated from source files on disk', async () => {
  const previousBasePath = pathService.getBasePath()
  const previousSourceFolder = pathService.getSrcFolder()
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-core-sfdx-retrieve-'))
  const archive = new yazl.ZipFile()
  archive.addBuffer(Buffer.from(`
    <Profile>
      <fieldPermissions><field>Invoice__c.Valid__c</field><readable>true</readable></fieldPermissions>
      <fieldPermissions><field>Invoice__c.Missing__c</field><readable>true</readable></fieldPermissions>
    </Profile>`), 'profiles/Admin.profile')
  archive.addBuffer(Buffer.from(`
    <CustomObject>
      <fields><fullName>Valid__c</fullName></fields>
    </CustomObject>`), 'objects/Invoice__c.object')
  archive.end()

  const outputPackage = {
    types: [{ name: ['Profile'], members: ['Admin'] }],
    version: ['65.0']
  }
  const retrievePackage = {
    types: [
      ...outputPackage.types,
      { name: ['CustomObject'], members: ['Invoice__c'] }
    ],
    version: ['65.0']
  }
  const mapping = {
    profiles: {
      directoryName: 'profiles',
      inFolder: 'false',
      metaFile: 'false',
      suffix: 'profile',
      xmlName: 'Profile'
    },
    objects: {
      directoryName: 'objects',
      inFolder: 'false',
      metaFile: 'false',
      suffix: 'object',
      xmlName: 'CustomObject'
    }
  }
  const connector = {
    sessionId: `core-sfdx-retrieve-${Date.now()}`,
    username: 'test@example.com',
    describeMetadata: async () => ({ metadataObjects: Object.values(mapping) })
  }
  const storedField = path.join(
    root,
    'src',
    'objects',
    'Invoice__c',
    'fields',
    'Stored__c.field-meta.xml'
  )

  try {
    pathService.setBasePath(root)
    pathService.setSrcFolder('src')
    await fs.promises.mkdir(path.dirname(storedField), { recursive: true })
    await fs.promises.writeFile(storedField, '<CustomField><fullName>Stored__c</fullName></CustomField>')

    await unzipRetrieve(
      await buffer(archive.outputStream),
      connector,
      outputPackage,
      sfdxAdapter.create(mapping),
      [{ type: 'Profile', fullName: 'Admin' }],
      {
        metadataPlugins: corePlugins,
        retrievePackage,
        config: { profiles: { stripUnversionedStuff: true } }
      }
    )

    const profilePath = path.join(root, 'src', 'profiles', 'Admin.profile-meta.xml')
    const profile = await parseXml(await fs.promises.readFile(profilePath))
    assert.deepEqual(
      profile.Profile.fieldPermissions.map(permission => permission.field[0]),
      ['Invoice__c.Valid__c']
    )
    assert.equal(
      await fs.promises.readFile(storedField, 'utf8'),
      '<CustomField><fullName>Stored__c</fullName></CustomField>'
    )
    assert.equal(fs.existsSync(path.join(root, 'src', 'objects', 'Invoice__c.object')), false)
  } finally {
    pathService.setBasePath(previousBasePath)
    pathService.setSrcFolder(previousSourceFolder)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
