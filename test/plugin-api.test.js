const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buffer } = require('node:stream/consumers')
const test = require('node:test')
const yazl = require('yazl')
const { FileSelection, FileTree, MetadataCollection, MetadataSelection, definePlugin, defineRenderer } = require('sfdy/plugin')
const { planExtensions, resolveSelections, runExtensions } = require('../src/plugin/runtime')
const LegacyExtension = require('../src/plugin/legacy-adapter')
const { prepareExtensions, warnLegacy } = require('../src/plugin/loader')
const logger = require('../src/services/log-service')
const staticResourceRenderer = require('../src/renderers/static-resource-bundle')

const entry = (fileName, data) => ({ fileName, data: Buffer.from(data) })

test('project view overlays incoming files on top of disk files', async () => {
  const tree = new FileTree({
    diskEntries: [
      entry('objects/Account.object', '<CustomObject><label>Old</label></CustomObject>'),
      entry('objects/Contact.object', '<CustomObject><label>Contact</label></CustomObject>')
    ],
    files: [
      entry('objects/Account.object', '<CustomObject><label>New</label></CustomObject>'),
      entry('objects/Vehicle__c.object', '<CustomObject><label>Vehicle</label></CustomObject>')
    ]
  })

  assert.deepEqual(
    tree.project.match('objects/**/*').map(file => file.path).sort(),
    ['objects/Account.object', 'objects/Contact.object', 'objects/Vehicle__c.object']
  )
  assert.match(await tree.project.get('objects/Account.object').readText(), /New/)
  assert.match(await tree.disk.get('objects/Account.object').readText(), /Old/)
})

test('disk contents are loaded lazily without changing the file API', async () => {
  let reads = 0
  const tree = new FileTree({
    diskEntries: [{
      fileName: 'objects/Account.object',
      loadData: () => {
        reads++
        return Buffer.from('<CustomObject/>')
      }
    }]
  })

  assert.deepEqual(tree.project.match('objects/**/*').map(file => file.path), ['objects/Account.object'])
  assert.equal(reads, 0)
  assert.equal(await tree.project.get('objects/Account.object').readText(), '<CustomObject/>')
  assert.equal(reads, 1)
  assert.equal(await tree.disk.get('objects/Account.object').readText(), '<CustomObject/>')
  assert.equal(reads, 1)
})

test('plugin XML errors identify the offending project file', async () => {
  const tree = new FileTree({
    files: [entry('profiles/Broken.profile', '<Profile>')]
  })

  await assert.rejects(
    tree.files.get('profiles/Broken.profile').readXml(),
    /Plugin XML file profiles\/Broken\.profile is not valid XML/
  )
})

test('XML writes are cached between plugins and remain explicit', async () => {
  const tree = new FileTree({
    files: [entry(
      'profiles/Admin.profile',
      '<Profile xmlns="http://soap.sforce.com/2006/04/metadata"><label>Initial</label></Profile>'
    )]
  })
  const file = tree.files.get('profiles/Admin.profile')

  const uncommitted = await file.readXml()
  uncommitted.label = ['Not written']
  assert.deepEqual((await file.readXml()).label, ['Initial'])

  const committed = await file.readXml()
  committed.label = ['First plugin']
  await file.writeXml(committed)
  const nextPlugin = await file.readXml()
  assert.deepEqual(nextPlugin.label, ['First plugin'])
  nextPlugin.description = ['Second plugin']
  await file.writeXml(nextPlugin)

  const output = await file.readText()
  assert.match(output, /xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata"/)
  assert.match(output, /<label>First plugin<\/label>/)
  assert.match(output, /<description>Second plugin<\/description>/)
})

test('excluded incoming files fall back to disk while deleted files hide it', async () => {
  const tree = new FileTree({
    diskEntries: [entry('profiles/Admin.profile', 'stored')],
    files: [entry('profiles/Admin.profile', 'incoming')]
  })

  tree.files.get('profiles/Admin.profile').exclude()
  assert.equal(await tree.project.get('profiles/Admin.profile').readText(), 'stored')
  assert.equal(tree.files.get('profiles/Admin.profile'), undefined)

  tree.files.delete('profiles/Admin.profile')
  assert.equal(tree.project.get('profiles/Admin.profile'), undefined)
  assert.equal(await tree.disk.get('profiles/Admin.profile').readText(), 'stored')
  assert.deepEqual(tree.deletedPaths(), ['profiles/Admin.profile'])
  assert.deepEqual(tree.diff().modified, [])
})

test('plugins can explicitly include project files and later plugins see changes', async () => {
  const tree = new FileTree({
    diskEntries: [entry('objects/Contact.object', '<CustomObject><label>Contact</label></CustomObject>')],
    files: [entry('profiles/Admin.profile', '<Profile/>')]
  })
  const stored = tree.project.get('objects/Contact.object')
  const editable = tree.files.include(stored)
  const object = await editable.readXml()
  object.label = ['Updated']
  await editable.writeXml(object)

  assert.match(await tree.project.get('objects/Contact.object').readText(), /Updated/)
  assert.match(await tree.disk.get('objects/Contact.object').readText(), /Contact/)
  assert.deepEqual(tree.diff().modified, ['objects/Contact.object'])
})

test('generated files are visible immediately and reported by the transaction', async () => {
  const tree = new FileTree()
  tree.files.create({ path: 'classes/Generated.cls', contents: 'class Generated {}' })

  assert.equal(await tree.project.get('classes/Generated.cls').readText(), 'class Generated {}')
  assert.deepEqual(tree.files.match('classes/*.cls').map(file => file.path), ['classes/Generated.cls'])
  assert.deepEqual(tree.diff().created, ['classes/Generated.cls'])
})

test('define helpers mark v2 extensions without changing their hooks', () => {
  const run = async () => {}
  const plugin = definePlugin({ name: 'plugin', run })
  const renderer = defineRenderer({ name: 'renderer', onRetrieve: run })

  assert.equal(plugin.apiVersion, 2)
  assert.equal(plugin.run, run)
  assert.equal(renderer.apiVersion, 2)
  assert.equal(renderer.onRetrieve, run)
})

test('v2 extensions plan metadata and modify files sequentially', async () => {
  const tree = new FileTree({
    files: [entry('profiles/Admin.profile', '<Profile><label>Initial</label></Profile>')]
  })
  const selection = new MetadataSelection([{ type: 'Profile', fullName: 'Admin' }])
  const inventory = new MetadataCollection([{ type: 'CustomObject', fullName: 'Account' }])
  const first = definePlugin({
    name: 'first',
    plan ({ selection, inventory }) {
      selection.include(inventory.match('CustomObject/*'))
    },
    async onRetrieve ({ files }) {
      const file = files.get('profiles/Admin.profile')
      const profile = await file.readXml()
      profile.label = ['First']
      await file.writeXml(profile)
      files.create({ path: 'classes/Generated.cls', contents: 'class Generated {}' })
    }
  })
  const second = definePlugin({
    name: 'second',
    async run ({ files, project }) {
      assert.equal(await project.get('classes/Generated.cls').readText(), 'class Generated {}')
      const file = files.get('profiles/Admin.profile')
      const profile = await file.readXml()
      profile.description = ['Second']
      await file.writeXml(profile)
    }
  })

  const options = {
    extensions: [first, second],
    direction: 'retrieve',
    format: 'sfdx',
    target: { environment: 'dev' },
    config: {},
    sfdcConnector: {}
  }
  await planExtensions({ ...options, selection, inventory })
  await runExtensions({ ...options, fileTree: tree })

  assert.equal(selection.has({ type: 'CustomObject', fullName: 'Account' }), true)
  const profile = await tree.files.get('profiles/Admin.profile').readText()
  assert.match(profile, /<label>First<\/label>/)
  assert.match(profile, /<description>Second<\/description>/)
})

test('legacy extensions run in order on the project format', async () => {
  const tree = new FileTree({
    diskEntries: [
      entry('objects/Account/fields/Stored__c.field-meta.xml', '<CustomField><label>Stored</label></CustomField>')
    ],
    files: [
      entry('objects/Account/fields/Incoming__c.field-meta.xml', '<CustomField><label>Incoming</label></CustomField>')
    ]
  })
  const legacy = new LegacyExtension({
    source: 'legacy.js',
    extension: async (context, helpers) => {
      helpers.xmlTransformer('objects/*/fields/*.field-meta.xml', async (fileName, field, requireFiles) => {
        const allFields = await requireFiles('objects/*/fields/*.field-meta.xml')
        field.description = [`${context.environment}:${allFields.length}`]
      })
    }
  })
  const v2 = definePlugin({
    name: 'v2',
    async onRetrieve ({ files }) {
      const file = files.get('objects/Account/fields/Incoming__c.field-meta.xml')
      const field = await file.readXml()
      field.label = [`${field.label[0]} v2`]
      await file.writeXml(field)
    }
  })

  await runExtensions({
    extensions: [legacy, v2],
    fileTree: tree,
    direction: 'retrieve',
    format: 'sfdx',
    target: { environment: 'uat' },
    config: {},
    sfdcConnector: {}
  })

  const incoming = await tree.files.get('objects/Account/fields/Incoming__c.field-meta.xml').readText()
  assert.match(incoming, /<description>uat:2<\/description>/)
  assert.match(incoming, /<label>Incoming v2<\/label>/)
  assert.equal(tree.files.has('objects/Account/fields/Stored__c.field-meta.xml'), true)
})

test('legacy package dependencies are adapted to the v2 selection', async () => {
  const legacy = new LegacyExtension({
    extension: async (context, helpers) => {
      helpers.requireMetadata('Profile/*', ({ filterPackage, patchPackage }) => {
        filterPackage(['CustomObject'])
        patchPackage(['CustomApplication/*'])
      })
    }
  })
  const selection = new MetadataSelection([{ type: 'Profile', fullName: 'Admin' }])
  const inventory = new MetadataCollection([{ type: 'CustomObject', fullName: 'Account' }])

  await planExtensions({
    extensions: [legacy],
    selection,
    inventory,
    direction: 'retrieve',
    format: 'sfdx',
    target: {},
    config: {},
    sfdcConnector: {}
  })

  assert.equal(selection.has({ type: 'CustomObject', fullName: 'Account' }), false)
  const plannedPackage = selection.toPackage()
  const plannedTypes = new Map(plannedPackage.types.map(type => [type.name[0], type.members]))
  assert.deepEqual(plannedTypes.get('CustomObject'), ['Account'])
  assert.deepEqual(plannedTypes.get('CustomApplication'), ['*'])
  assert.equal(selection.toOutputPackage().types.some(type => type.name[0] === 'CustomObject'), false)
})

test('legacy path remappers participate in v2 selection resolution', async () => {
  const legacy = new LegacyExtension({
    extension: async (context, helpers) => {
      helpers.addRemapper(/^staticresources\/([^/]+)\/.*$/, (fileName, regexp) =>
        `staticresources/${fileName.match(regexp)[1]}.resource`)
    }
  })
  const selection = new FileSelection(['staticresources/App/main.js'])
  await resolveSelections({
    extensions: [legacy],
    selection,
    project: new FileTree().project,
    direction: 'deploy',
    format: 'metadata',
    target: {},
    config: {},
    sfdcConnector: {}
  })

  assert.deepEqual(selection.values(), ['staticresources/App.resource'])
})

test('configured legacy extensions emit one deprecation warning per run', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-legacy-warning-'))
  const pluginPath = path.join(root, 'legacy.js')
  await fs.promises.writeFile(pluginPath, 'module.exports = async () => {}\n')
  const messages = []
  logger.setLogger(message => messages.push(String(message)))
  try {
    const prepared = prepareExtensions({
      entries: ['legacy.js'],
      basePath: root,
      packageJson: {}
    })
    warnLegacy(prepared.legacy, 'Plugin')
    assert.equal(messages.length, 1)
    assert.match(messages[0], /Plugin API v1 detected/)
    assert.match(messages[0], /legacy\.js/)
    assert.match(messages[0], /runs in the project format/)
    assert.doesNotMatch(messages[0], /only for Metadata API projects/)
  } finally {
    logger.setLogger(console.log)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('configured v2 extensions load TypeScript-style default exports', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-v2-default-'))
  const pluginPath = path.join(root, 'plugin.js')
  await fs.promises.writeFile(pluginPath, `
    Object.defineProperty(exports, '__esModule', { value: true })
    exports.default = { apiVersion: 2, name: 'default-export' }
  `)
  try {
    const prepared = prepareExtensions({
      entries: ['plugin.js'],
      basePath: root,
      packageJson: {}
    })
    assert.equal(prepared.extensions[0].name, 'default-export')
    assert.deepEqual(prepared.legacy, [])
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('configuration can override stage and project formats for v2 extensions', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfdy-v2-stage-'))
  const pluginPath = path.join(root, 'plugin.js')
  await fs.promises.writeFile(pluginPath, `
    module.exports = { apiVersion: 2, name: 'configured-stage' }
  `)
  try {
    const prepared = prepareExtensions({
      entries: [{ path: 'plugin.js', stage: 'metadata', formats: ['sfdx'] }],
      basePath: root,
      packageJson: {}
    })
    assert.equal(prepared.extensions[0].stage, 'metadata')
    assert.deepEqual(prepared.extensions[0].formats, ['sfdx'])
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('v2 static resource renderer keeps bundle and cleanup semantics', async () => {
  const archive = new yazl.ZipFile()
  archive.addBuffer(Buffer.from('new content'), 'main.js')
  archive.end()
  const archiveData = await buffer(archive.outputStream)
  const descriptor = '<StaticResource><contentType>application/zip</contentType></StaticResource>'
  const retrieveTree = new FileTree({
    diskEntries: [entry('staticresources/App/old.js', 'old content')],
    files: [
      entry('staticresources/App.resource', archiveData),
      entry('staticresources/App.resource-meta.xml', descriptor)
    ]
  })
  await runExtensions({
    extensions: [staticResourceRenderer],
    fileTree: retrieveTree,
    direction: 'retrieve',
    format: 'metadata',
    target: {},
    config: { staticResources: { useBundleRenderer: ['*'] } },
    sfdcConnector: {}
  })

  assert.deepEqual(retrieveTree.entries().map(item => item.fileName).sort(), [
    'staticresources/App.resource-meta.xml',
    'staticresources/App/main.js'
  ])
  assert.equal(retrieveTree.deletedPaths().includes('staticresources/App/old.js'), true)

  const deployTree = new FileTree({
    diskEntries: [
      entry('staticresources/App/main.js', 'new content'),
      entry('staticresources/App.resource-meta.xml', descriptor)
    ],
    files: [entry('staticresources/App.resource-meta.xml', descriptor)],
    origin: 'disk'
  })
  await runExtensions({
    extensions: [staticResourceRenderer],
    fileTree: deployTree,
    direction: 'deploy',
    format: 'metadata',
    target: {},
    config: { staticResources: { useBundleRenderer: ['*'] } },
    sfdcConnector: {}
  })

  assert.deepEqual(deployTree.entries().map(item => item.fileName).sort(), [
    'staticresources/App.resource',
    'staticresources/App.resource-meta.xml'
  ])
})
