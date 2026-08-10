# Migrating plugins to Plugin API v2

Plugin API v1 remains supported throughout the `sfdy` 2.x series. Existing
plugins and renderers are loaded through a compatibility adapter and emit a
deprecation warning. The adapter will be removed in `sfdy` 3.

Migration is recommended now, and is required when a format-dependent v1
extension is used with a Salesforce DX project.

## What changed

Plugin API v1 registered transformations through helper functions. Plugin API
v2 exports an object with explicit lifecycle hooks and works directly with the
files involved in the current operation.

The most important choice is the stage:

- `stage: 'metadata'` exposes Metadata API paths and XML in both Metadata API
  and Salesforce DX projects. This is normally the right choice when migrating
  a v1 plugin.
- `stage: 'project'` is the default and exposes files exactly as they are stored
  in the repository. Use it for new project conventions or plugins that are
  intentionally aware of the source format.

The v1 compatibility adapter runs in the `project` stage. A legacy plugin can
therefore keep working unchanged in a Metadata API project but match different
paths in a Salesforce DX project.

Configuration does not have to change. Migrated modules still belong in
`preDeployPlugins`, `postRetrievePlugins` or `renderers`:

```json
{
  "preDeployPlugins": ["sfdy-plugins/environment-endpoints.js"],
  "postRetrievePlugins": ["sfdy-plugins/normalize-retrieve.js"],
  "renderers": ["sfdy-renderers/custom-renderer.js"]
}
```

## A complete plugin migration

This v1 plugin changes a Named Credential endpoint before deploy:

```js
module.exports = async ({ environment, log }, helpers) => {
  helpers.xmlTransformer('namedCredentials/*', async (filename, xml) => {
    const endpoints = {
      dev: 'https://dev.example.com',
      uat: 'https://uat.example.com',
      prod: 'https://api.example.com'
    }

    if (!endpoints[environment]) throw new Error(`Unknown environment: ${environment}`)

    xml.endpoint = [endpoints[environment]]
    log(`Changed ${filename}`)
  })
}
```

The equivalent v2 plugin is:

```js
const { definePlugin } = require('sfdy/plugin')

module.exports = definePlugin({
  name: 'environment-endpoints',
  stage: 'metadata',

  async onDeploy ({ files, target, log }) {
    const endpoints = {
      dev: 'https://dev.example.com',
      uat: 'https://uat.example.com',
      prod: 'https://api.example.com'
    }
    const endpoint = endpoints[target.environment]

    if (!endpoint) throw new Error(`Unknown environment: ${target.environment}`)

    for (const file of files.match('namedCredentials/*.namedCredential')) {
      const xml = await file.readXml()
      xml.endpoint = [endpoint]
      await file.writeXml(xml)
      log.info(`Changed ${file.path}`)
    }
  }
})
```

The differences are deliberately mechanical:

- the module is wrapped with `definePlugin`;
- the deploy behavior lives in `onDeploy`;
- the old `environment` value is now `target.environment`;
- files are matched, read and written explicitly;
- `stage: 'metadata'` keeps the plugin independent of the project format.

Use `onRetrieve` for a post-retrieve plugin. Use `run` only when exactly the
same transformation must run in both directions.

## v1 to v2 reference

| Plugin API v1 | Plugin API v2 |
| --- | --- |
| Exported function | `definePlugin({ ... })` |
| `context.environment` | `target.environment` |
| `context.username` | `target.username` |
| `context.sfdcConnector` | `salesforce` |
| `context.config` | `config` |
| `context.log(message)` | `log.info(message)` or another log level |
| `xmlTransformer(pattern, callback)` | `files.match(pattern)`, `readXml()` and `writeXml()` |
| `modifyRawContent(pattern, callback)` | `files.match(pattern)`, `readBytes()` and `writeBytes()` |
| `filterMetadata(predicate)` | `files.excludeWhere(file => !predicate(file.path))` |
| `requireMetadata(...)` | `plan({ selection, inventory })` and `selection.require(...)` |
| `requireFiles(patterns)` | `project.match(patterns)` and `files.include(file)` |
| `addFiles(entries)` | `files.create({ path, contents })` |
| `cleanFiles(patterns)` | `files.delete(patterns)` or `output.delete(patterns)` after retrieve |
| `addRemapper(regexp, callback)` | A renderer with `resolveSelection({ selection })` |
| `utils.parseXml` / `buildXml` | `file.readXml()` / `file.writeXml()` |
| `context.pkg` | Inspect or change metadata through `selection` in `plan` |

The v2 XML representation still omits the document root and represents child
elements as arrays.

## Migrating retrieve dependencies

A v1 `requireMetadata` registration becomes a `plan` hook. For example, a
Profile plugin that also needs locally versioned objects can use:

```js
const { definePlugin } = require('sfdy/plugin')

module.exports = definePlugin({
  name: 'profile-object-dependencies',
  stage: 'metadata',

  plan ({ selection, inventory }) {
    if (!selection.match('Profile/*').length) return
    selection.require(inventory.match('CustomObject/*'))
  },

  async onRetrieve ({ files }) {
    // Profile files now contain the information contributed by those objects.
  }
})
```

`selection.require()` retrieves a dependency without writing it to the final
output unless it was selected independently. `selection.include()` both
retrieves it and includes it in the output.

## Migrating renderers

A v1 renderer exports `transform` and `untransform`. A v2 renderer uses
`onRetrieve` and `onDeploy`:

```js
const { defineRenderer } = require('sfdy/plugin')

module.exports = defineRenderer({
  name: 'custom-renderer',

  resolveSelection ({ selection }) {
    // Expand a partial file selection when the complete artifact is required.
  },

  async onRetrieve ({ files, project, output }) {
    // Convert Salesforce files to the representation stored in Git.
  },

  async onDeploy ({ files, project }) {
    // Rebuild the representation accepted by Salesforce.
  }
})
```

Move path remapping from `addRemapper` to `resolveSelection`. Use
`output.delete()` during retrieve when an old rendered file or directory must
be removed from disk before the new representation is written.

## Migration checklist

1. Wrap the extension with `definePlugin` or `defineRenderer`.
2. Give it a stable `name`.
3. Use `stage: 'metadata'` unless it intentionally operates on repository
   paths.
4. Move the code into the matching lifecycle hooks.
5. Replace helper registrations with direct file or selection operations.
6. Test a full and partial retrieve or deploy.
7. Test both Metadata API and Salesforce DX projects when both are supported.
8. Confirm that the v1 deprecation warning has disappeared.

The complete lifecycle and type reference remains in the main
[README](README.md#extending-sfdy).
