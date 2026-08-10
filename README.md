# sfdy

## Small, stable infrastructure for Salesforce metadata delivery

`sfdy` gets Salesforce metadata into Git and safely back out again. It
retrieves, normalizes, validates and deploys Metadata API and Salesforce DX
projects—in full, by file, or directly from a Git diff.

The same small engine runs from the terminal, in CI/CD and behind the
[fast-sfdc VS Code extension](https://marketplace.visualstudio.com/items?itemName=m1ck83.fast-sfdc).

## Contents

- [Quick start](#quick-start)
- [Why sfdy](#why-sfdy)
- [Small by design](#small-by-design)
- [Command-line workflows](#command-line-workflows)
- [Standard patches and custom plugins](#standard-patches-and-custom-plugins)
- [Extending sfdy](#extending-sfdy)
- [Plugin API v2 migration](MIGRATING_PLUGINS_TO_V2.md)
- [JavaScript API](#javascript-api)
- [Where sfdy fits](#where-sfdy-fits)
- [Changelog](CHANGELOG.md)

## Quick start

`sfdy` requires Node.js 22 or newer. Install it once, then run one command from
an empty directory or an existing Salesforce project:

```bash
npm install --global sfdy
mkdir your-salesforce-project
cd your-salesforce-project
git init
sfdy create
```

`sfdy create` detects the project format and source directory when they already
exist. Otherwise it creates the project, asks which metadata you want, opens
Salesforce login, optionally saves the credential securely and runs the first
retrieve.

Accept the defaults and you get a Salesforce DX project containing the org's
Apex classes and Lightning web components. The API version is detected from an
existing project and otherwise defaults to `65.0`.

Commit the result, work normally, then deploy only the change:

```bash
git add .
git commit -m 'Import Salesforce metadata'

# Edit files, then:
git add .
git commit -m 'Update account components'
sfdy deploy --diff='HEAD~1..HEAD'
```

The deploy command lets you select any login saved for the project. Pass its
alias when the command must be non-interactive:

```bash
sfdy deploy --target uat --diff='origin/main..HEAD'
```

That is the complete local loop: create, retrieve, edit, commit, delta deploy.
No mandatory manifest, separate delta generator or Salesforce CLI installation.

## Why sfdy

### Easy on the first run and the thousandth

The first command discovers what it can and asks only for what it cannot know.
Afterwards, the CLI works with project paths, metadata names, glob patterns and
Git ranges directly.

`package.xml` is optional. Authentication profiles are named, securely stored
per project and selected with the same `--target` option across commands. Every
interactive choice also has an explicit flag for scripts and CI/CD.

### One engine from VS Code to production

The CLI, JavaScript API and `fast-sfdc` use the same project configuration,
credential vault, format adapters and transformation pipeline. An org added in
fast-sfdc is immediately available to `sfdy` in that project, and a login saved
by `sfdy` appears in fast-sfdc.

What a developer deploys from VS Code is therefore prepared by the same code
that validates a pull request and deploys it to production. There is no second
implementation whose behavior must be kept approximately aligned.

For unattended jobs, `sfdy` supports OAuth 2.0 client credentials, meaningful
process exit codes, check-only deployments, quick deploys and JUnit test
reports. It can also be imported directly instead of being wrapped in shell
scripts:

```js
const { deploy, retrieve } = require('sfdy')
```

### Metadata patching is part of delivery

Salesforce metadata is not always stable, complete or portable between orgs.
`sfdy` can normalize it after retrieve and patch it in memory before deploy,
without changing the canonical files tracked by Git.

Built-in patches handle common profile, permission, translation, managed-
package and static-resource problems. Small JavaScript plugins can transform
XML or arbitrary files, retrieve related metadata, query Salesforce, or apply
environment-specific values at the deployment boundary.

A credential can carry a logical environment such as `dev`, `uat` or `prod`.
Plugins receive it as `target.environment`, so the same command and source can
be used for every target:

```bash
sfdy auth --save --alias uat --environment uat
sfdy deploy --target uat --diff='origin/main..HEAD'
```

Renderers go one step further and let Git store a cleaner representation than
Salesforce accepts. The built-in static-resource renderer, for example, keeps
archives as ordinary directories and rebuilds them only for deployment.

### Delta deploy is a deploy mode

Deploy the files changed between any two Git references directly:

```bash
sfdy deploy --diff='origin/main..HEAD'
```

`sfdy` resolves the changed metadata, builds the manifest, runs renderers and
pre-deploy patches, and sends the result to the Metadata API. There is no
separate plugin, generated delta project or intermediate artifact to manage.

File patterns can refine the selection:

```bash
sfdy deploy \
  --diff='origin/main..HEAD' \
  --files='!experiences/EnvironmentSpecificSite/**'
```

Deletions remain explicit destructive deployments instead of being inferred
from an absent local file.

## Small by design

`sfdy` follows the 80/20 rule deliberately. It does not reproduce every command
in the Salesforce developer toolchain; it focuses on the small, stable set of
capabilities behind most metadata delivery workflows.

It has powered real Salesforce projects since 2019 while remaining only a few
thousand lines of runtime JavaScript. It does not depend on Salesforce CLI or
jsforce. Its narrow scope means quick startup, fewer dependencies, less churn,
a codebase that can still be understood, and upgrades driven by actual platform
changes rather than perpetual reinvention.

Small does not mean frozen. OAuth 2.0 client credentials, Salesforce source
format, secure shared credentials and Plugin API v2 were added without
replacing the workflow around them. Delivery infrastructure should be boring:
put it in place and spend your attention on the software being delivered.

## Command-line workflows

The CLI has eight commands:

| Command | Purpose |
| --- | --- |
| `sfdy create` | Detect or scaffold a project, authenticate and run its first retrieve |
| `sfdy init` | Generate the opinionated legacy starter configuration |
| `sfdy auth` | Authorize an org interactively |
| `sfdy credentials` | List or remove project credentials |
| `sfdy retrieve` | Retrieve and normalize metadata |
| `sfdy deploy` | Prepare and deploy metadata |
| `sfdy prepare` | Reapply the retrieve pipeline to local files |
| `sfdy community:publish` | Publish an Experience Cloud site |

Run `sfdy <command> --help` for the complete option list.

### Configure a project

Run `sfdy create` from the project root. It preserves an existing project and
writes the minimal `.sfdy.json` needed by the CLI. The older `sfdy init`
command remains available when you explicitly want its opinionated starter set
of built-in patches:

```bash
sfdy init --api-version 65.0
```

A project's `.sfdy.json` controls its format, source root, built-in patches,
plugins, renderers and files that must never be deployed. `sfdy create` writes
only the detected or selected format and API version; add policy as the project
needs it. For example:

```json
{
  "sourceFormat": "sfdx",
  "excludeFiles": ["lwc/**/__tests__/**/*"],
  "preDeployPlugins": [],
  "postRetrievePlugins": [],
  "renderers": []
}
```

`sfdy create` proposes `sfdx` for a new project. When no format is configured,
the lower-level deploy and retrieve APIs retain `metadata` as their backwards-
compatible default. `--source-format` overrides the configured format for one
deploy or retrieve.

Every wizard choice can be supplied explicitly. For example:

```bash
sfdy create . \
  --source-format=sfdx \
  --api-version=65.0 \
  --metadata='ApexClass/*,LightningComponentBundle/*' \
  --sandbox \
  --save \
  --alias=dev \
  --environment=dev
```

Use `--no-retrieve` to configure and authenticate without performing the first
retrieve. Pass another directory as the positional argument to create or
connect that project without changing the current directory.

The default source root is:

- `src` for Metadata API projects;
- the default package directory from `sfdx-project.json` for source-format
  projects, normally `force-app/main/default`.

Set `sourceFolder` in `.sfdy.json` or pass `--folder` to override it.
`apiVersion` can come from `.sfdy.json`, `sfdx-project.json` or an existing
`package.xml`.

`package.xml` is optional in both formats. `sfdy` builds manifests from the
local source inventory and the current selection.

### Authenticate to a target org

Deploy, retrieve, prepare and community publishing accept exactly one
authentication method:

| Use case | Credentials |
| --- | --- |
| Saved project login | `--target <alias>` or `--username <username>` |
| CI/CD | `SFDY_SERVER_URL`, `SFDY_CLIENT_ID`, `SFDY_CLIENT_SECRET` |
| Local OAuth | `SFDY_INSTANCE_URL`, `SFDY_REFRESH_TOKEN` |
| Legacy login | `--username` and `--password` |

Save an OAuth login directly in the project:

```bash
sfdy auth --save --alias dev
sfdy retrieve --target dev
```

The credential alias is also used as its plugin environment by default. Use
`--environment` only when several credentials should share the same logical
environment, for example `--alias uat-admin --environment uat`.
When `--alias` is omitted in an interactive terminal, `sfdy` asks for one and
does not accept an empty value. Non-interactive authentication with `--save`
requires `--alias` explicitly.

The encrypted vault lives in `.sfdy/credentials.vault` and is automatically
ignored by Git. Only its encryption key is stored in the operating-system
keychain, so `sfdy` and `fast-sfdc` can safely use the same project credentials.

There is deliberately no implicit current target. Without complete command-line
or environment credentials, pass `--target` (or a saved username) explicitly.
In an interactive terminal, omitting it always opens the credential picker. In
CI or any non-interactive process, omitting it is an error.

```bash
sfdy credentials
sfdy credentials --json
sfdy credentials --remove dev
```

OAuth client credentials are recommended for CI/CD. `SFDY_SERVER_URL` must be
the org's My Domain URL, including the sandbox domain when applicable:

```bash
export SFDY_SERVER_URL='https://acme--uat.sandbox.my.salesforce.com'
export SFDY_CLIENT_ID='connected-app-consumer-key'
export SFDY_CLIENT_SECRET='connected-app-consumer-secret'

sfdy deploy --validate
```

For an ephemeral local session, run the web-server flow without `--save`, then
export the instance URL and refresh token it prints:

```bash
sfdy auth --sandbox
export SFDY_INSTANCE_URL='https://your-instance.my.salesforce.com'
export SFDY_REFRESH_TOKEN='your-refresh-token'
sfdy retrieve
```

`-s` selects the sandbox login endpoint. A custom Connected App can be passed
with `--client-id` and `--client-secret`; its callback URL must match
`http://localhost:3000/callback`, or the port selected with `--callback-port`.

Credentials can also be passed as command options. Environment variables are
preferable in CI because they can be stored as protected secrets and do not
appear in the command line.

### Retrieve metadata

With no selection, `sfdy retrieve` retrieves every component already
represented by the local source tree:

```bash
sfdy retrieve
```

This is an inventory-based retrieve, not a request for every component in the
org. Use `--meta` to introduce metadata that does not exist locally:

```bash
sfdy retrieve --meta='CustomObject/Account,FlexiPage/Home'
```

Metadata selections use `MetadataType/fullName`. Salesforce wildcards are
supported where the Metadata API supports them:

```bash
sfdy retrieve --meta='ApexClass/*'
```

Use `--files` to select metadata through project-relative paths and glob
patterns:

```bash
sfdy retrieve --files='classes/AccountService.cls,objects/Account.object'
```

In a source-format project, individual decomposed components can be selected
directly:

```bash
sfdy retrieve \
  --files='objects/Account/fields/Status__c.field-meta.xml'
```

Exact directory paths are recursive, and selecting a file inside an Aura,
LWC, Experience or other bundle selects the required companion files in
source-format projects. Negated glob patterns can remove paths from a broader
selection.

After Salesforce responds, `sfdy` runs built-in metadata patches, configured
`postRetrievePlugins` and renderers before writing the result to disk.

### Deploy metadata

With no selection, `sfdy deploy` deploys the complete local metadata
inventory:

```bash
sfdy deploy
```

Use `--files` for a partial deployment:

```bash
sfdy deploy --files='classes/AccountService.cls,lwc/accountCard'
```

Use `--diff` to deploy files added or modified between two Git references:

```bash
sfdy deploy --diff='origin/main..HEAD'
```

`--diff` and `--files` can be combined. This is useful for applying exclusions
to a Git delta:

```bash
sfdy deploy \
  --diff='origin/main..HEAD' \
  --files='!experiences/EnvironmentSpecificSite/**'
```

Git-diff deployments intentionally ignore deleted files. Handle removals with
an explicit destructive deployment rather than inferring deletion from a
missing local file.

Renderers and `preDeployPlugins` run in memory before the deployment ZIP is
created; they do not modify the source tree.

#### Validate and run tests

`--validate` performs a check-only deployment. Test options are passed to the
Metadata API, and `--test-report` writes `test-report.xml` in JUnit format:

```bash
sfdy deploy \
  --diff='origin/main..HEAD' \
  --validate \
  --test-level=RunSpecifiedTests \
  --specified-tests='AccountServiceTest,ContactServiceTest' \
  --test-report
```

After a successful validation, use its deployment ID for a quick deploy:

```bash
sfdy deploy --quick-deploy='0Af...'
```

The deploy command exits with a non-zero status when Salesforce does not
report `Succeeded`, making it safe to use as a pipeline gate.

#### Destructive deployments

Select existing local metadata and add `--destructive` to build a destructive
changeset from that selection:

```bash
sfdy deploy --files='classes/ObsoleteService.cls' --destructive
```

The metadata is removed from Salesforce but remains on disk. If the local
file has already been deleted, provide a destructive manifest instead:

```bash
sfdy deploy --destructive='manifest/destructiveChanges.xml'
```

Add `--ignoreWarnings` when missing components should not fail the job. Full
destructive deployments are deliberately rejected: a file selection or an
explicit manifest is required.

### Environment-specific deployments

The repository should contain one canonical representation of its metadata.
Target-specific values belong at the deployment boundary, where they can be
applied without changing tracked files.

Assign a logical environment when saving a credential:

```bash
sfdy auth --save --alias uat-admin --environment uat
sfdy deploy --target uat-admin --diff='origin/main..HEAD'
```

The selected profile exposes `uat` to plugins as `target.environment`. The
credential alias is used as the environment when `--environment` is omitted.
The lowercase `environment` process variable can still override it for an
ephemeral or CI/CD invocation.

A metadata-stage pre-deploy plugin can apply the same policy to Metadata API
and source-format projects. The
[environment endpoint example](#a-complete-plugin) below maps `dev`, `uat` and
`prod` to different Named Credential endpoints.

This keeps the responsibilities separate:

- authentication variables identify and authorize the Salesforce org;
- `environment` selects the logical configuration policy;
- the plugin transforms the in-memory deployment payload;
- Git retains the environment-neutral source of truth.

The same plugin runs during `--validate` and the final deploy. It receives
`checkOnly` when behavior or logging needs to distinguish the two operations.

For values that also vary on retrieve, use a `postRetrievePlugin` to normalize
the org-specific value back to the canonical repository form. Together, the
retrieve and deploy hooks form a controlled boundary around environment
differences rather than scattering them through pipeline scripts.

### Reapply patches locally

`sfdy prepare` runs the retrieve-side normalization pipeline against the
current source tree without retrieving metadata:

```bash
sfdy prepare --target dev
```

It applies configured renderers, built-in metadata patches and
`postRetrievePlugins`, then writes the resulting project representation. The
command still authenticates because a plugin may query the target org. Set the
lowercase `environment` process variable when you need to override the logical
environment stored with the selected credential.

`--skip-untransform` skips the deploy direction of configured renderers before
normalization.

### Convert the project source format

Convert the whole local project to the opposite representation without a
retrieve or deploy:

```bash
sfdy convert --target dev
```

A Metadata API project becomes Salesforce DX source format; a source-format
project becomes Metadata API format. Use `--to source` or `--to mdapi` to make
the destination explicit. The source folder is preserved unless `--folder` is
provided.

The command first runs the current format's renderers in the deploy direction,
converts through the Metadata API representation, and then runs the destination
format's renderers in the retrieve direction. Conversion and rendering finish
in memory before project files are rewritten. `.sfdy.json` is updated, and a
conversion to source format also creates or updates `sfdx-project.json`.

### Publish an Experience Cloud site

Publish a site by its Salesforce community name, normally after a successful
deployment:

```bash
sfdy community:publish --community-name='Customer Portal'
```

## Standard patches and custom plugins

Salesforce often returns metadata that is incomplete, noisy or coupled to
components that are not part of the repository. `sfdy` includes opt-in patches
for normalizing that metadata after retrieve: they can remove ineffective
Profile entries, complete permissions omitted by Salesforce, discard
references to unversioned components, clean translations and managed-package
artifacts, and exclude generated partner roles.

Built-in patches do not go in `postRetrievePlugins`. Enable them directly in
`.sfdy.json`:

```json
{
  "objectTranslations": {
    "stripUntranslatedFields": true,
    "stripNotVersionedFields": true
  },
  "profiles": {
    "addDisabledVersionedObjects": true,
    "stripUserPermissionsFromStandardProfiles": true,
    "stripUnversionedStuff": true
  },
  "roles": {
    "stripPartnerRoles": true
  },
  "stripManagedPackageFields": ["managed_namespace__"]
}
```

`sfdy create` intentionally leaves these choices disabled. Enable only the
normalizations that express how your repository should look. Standard patches
run on retrieved Metadata API files and when using `sfdy prepare`; they do not
silently rewrite files during deploy. Profile completion patches may query the
target org, but inactive patches are skipped before any query is made.

The built-in static-resource renderer is configured separately and runs in
both directions for Metadata API projects:

```json
{
  "staticResources": {
    "useBundleRenderer": ["*"]
  }
}
```

The [standard patch reference](STANDARD_PATCHES.md) documents every key,
affected metadata type, glob syntax, org query and the opinionated starter
configuration generated by `sfdy init`.

Custom plugins are ordinary project-relative JavaScript modules. Register them
in `postRetrievePlugins` to normalize incoming metadata, in
`preDeployPlugins` to adapt a deployment to its target, or in both arrays when
the module implements both directions:

```json
{
  "postRetrievePlugins": ["sfdy-plugins/normalize.js"],
  "preDeployPlugins": ["sfdy-plugins/environment-values.js"]
}
```

Use `stage: "metadata"` when one plugin should see the same Metadata API paths
in both Metadata API and SFDX projects; omit it when the plugin should operate
on files exactly as stored in the repository. The next section contains a
complete plugin and the full API.

## Extending sfdy

Plugin API v2 is available from `sfdy/plugin`. It provides a small typed API
for changing the metadata selection, reading the whole project and applying
transactional file changes.

Extensions are ordinary JavaScript modules. They run sequentially, in their
configured order, and changes made by one extension are immediately visible
to the next one.

### Plugin or renderer?

Use a **plugin** when the repository representation stays the same and its
contents need to be completed, filtered or adapted. Typical examples are
removing noisy profile entries after retrieve or changing a Named Credential
endpoint before deploy.

Use a **renderer** when the repository representation itself differs from what
Salesforce accepts. A renderer is bidirectional: `onRetrieve` creates the
repository representation and `onDeploy` converts it back. The built-in static
resource renderer, for example, stores a `.resource` ZIP as an ordinary folder
and rebuilds the archive at deploy time.

| Extension | Configure in | Purpose |
| --- | --- | --- |
| Retrieve plugin | `postRetrievePlugins` | Normalize or enrich retrieved metadata |
| Deploy plugin | `preDeployPlugins` | Prepare metadata for the target org |
| Renderer | `renderers` | Maintain a reversible repository representation |

Pre-deploy plugins do not run during destructive deployments. Renderers still
run because they may be needed to resolve the selected metadata.

### Configuration

Extension paths are resolved from the project root:

```json
{
  "preDeployPlugins": [
    {
      "path": "sfdy-plugins/environment-endpoints.js",
      "stage": "metadata",
      "formats": ["metadata", "sfdx"]
    }
  ],
  "postRetrievePlugins": [
    "sfdy-plugins/normalize-retrieve.js"
  ],
  "renderers": [
    "sfdy-renderers/custom-renderer.js"
  ]
}
```

A string uses the extension's declared `stage` and `formats`. The object form
can override either setting without changing a shared extension. CommonJS
exports and transpiled default exports are both supported.

### A complete plugin

Custom configuration keys can keep the environment map outside the plugin.
The same extension can be registered in both directions to apply the target
value on deploy and restore the canonical repository value on retrieve:

```json
{
  "canonicalBackendUrl": "https://service.example.invalid",
  "environments": {
    "dev": { "backendUrl": "https://dev.example.com" },
    "uat": { "backendUrl": "https://uat.example.com" },
    "prod": { "backendUrl": "https://api.example.com" }
  },
  "preDeployPlugins": ["sfdy-plugins/environment-endpoints.js"],
  "postRetrievePlugins": ["sfdy-plugins/environment-endpoints.js"]
}
```

```js
const { definePlugin } = require('sfdy/plugin')

const setEndpoint = async (files, endpoint) => {
  for (const file of files.match('namedCredentials/*.namedCredential')) {
    const credential = await file.readXml()
    credential.endpoint = [endpoint]
    await file.writeXml(credential)
  }
}

module.exports = definePlugin({
  name: 'environment-endpoints',
  stage: 'metadata',
  formats: ['metadata', 'sfdx'],

  async onDeploy ({ files, target, config, checkOnly, log }) {
    const endpoint = config.environments?.[target.environment]?.backendUrl

    if (!endpoint) {
      throw new Error(`No endpoint configured for ${target.environment}`)
    }

    await setEndpoint(files, endpoint)
    log.info(`${checkOnly ? 'Validating' : 'Deploying'} backend for ${target.environment}`)
  },

  async onRetrieve ({ files, config }) {
    await setEndpoint(files, config.canonicalBackendUrl)
  }
})
```

Run it against a saved target carrying the corresponding environment:

```bash
sfdy deploy \
  --target uat-admin \
  --files='namedCredentials/Backend.namedCredential*'
```

`definePlugin` marks the module as Plugin API v2 and preserves type inference
for JavaScript editors and TypeScript.

### Lifecycle and representations

Extensions can run against two representations:

| Stage | Representation | Best suited for |
| --- | --- | --- |
| `project` (default) | Files exactly as stored in the project | Repository conventions and custom layouts |
| `metadata` | Metadata API paths and XML | Salesforce semantics independent of project format |

For a Salesforce source-format project, `metadata` plugins run after source
files have been composed for deploy and before they are decomposed on
retrieve. The plugin therefore sees the same Metadata API representation in
both `metadata` and `sfdx` projects. Built-in metadata patches use this stage.

The high-level pipelines are:

```text
retrieve: plan -> Metadata API -> metadata plugins -> format conversion
          -> project plugins -> renderers -> disk

deploy:   selection resolution -> renderers -> project plugins
          -> format conversion -> metadata plugins -> Metadata API
```

Within a matching plugin, `run` executes first and is followed by
`onRetrieve` or `onDeploy`. Use `run` for direction-independent behavior and a
directional hook when the operation matters.

The optional `formats` property limits an extension to `metadata`, `sfdx`, or
both project formats. `format` always describes the project, even while a
plugin is running at the `metadata` stage.

The optional `enabled(context)` predicate skips the extension before any hook
in the current phase. It may inspect `config`, `direction`, `format`, `target`
and the phase-specific `selection` or `files` view. Keep it cheap and free of
I/O; its purpose is to avoid loading or querying data for inactive patches.
It may return a boolean or a promise:

```js
enabled: ({ config, files }) =>
  config.profiles?.normalize === true &&
  (!files || files.match('profiles/**/*').length > 0)
```

If an extension participates in more than one phase, `enabled` is evaluated
once before its hooks in each phase.

#### Plugin hooks

| Hook | When it runs |
| --- | --- |
| `enabled(context)` | Before the extension's hooks in the current phase; returning `false` skips it |
| `plan(context)` | Before a retrieve; can change which components Salesforce returns |
| `run(context)` | In either direction, at the configured stage |
| `onRetrieve(context)` | During retrieve, after `run` |
| `onDeploy(context)` | During deploy, after `run`; also receives `checkOnly` and `destructive` |

#### Renderer hooks

| Hook | When it runs |
| --- | --- |
| `enabled(context)` | Before the renderer's hooks in the current phase; returning `false` skips it |
| `resolveSelection(context)` | Before a partial operation; maps selected project paths to the files the renderer needs |
| `onRetrieve(context)` | Converts retrieved files into their repository representation |
| `onDeploy(context)` | Rebuilds deployable files from the repository representation |

### Planning retrieve dependencies

`plan` works with metadata addresses shaped as `{ type, fullName }`. It can
add a selected component or retrieve a dependency only for use by plugins:

```js
const { definePlugin } = require('sfdy/plugin')

module.exports = definePlugin({
  name: 'profile-dependencies',
  stage: 'metadata',

  plan ({ selection, inventory }) {
    if (!selection.match('Profile/*').length) return

    selection.require(inventory.match([
      'CustomObject/*',
      'ApexClass/*',
      'Layout/*'
    ]))
  }
})
```

- `selection.include(addresses)` adds components to both the retrieve and its
  output.
- `selection.require(addresses)` retrieves dependencies but does not write
  them unless they were selected independently.
- `selection.exclude(addresses)` removes components from the output
  selection.
- `selection.match(globs)` and `inventory.match(globs)` return matching
  metadata addresses.

`inventory` represents metadata already known to the local project. Glob
patterns use the `MetadataType/fullName` form.

### The file context

Runtime hooks receive four views of the current operation:

| Property | Access | Meaning |
| --- | --- | --- |
| `files` | Read/write | Files currently included in the operation |
| `project` | Read-only | Current project view: active changes overlaid on stored files |
| `disk` | Read-only | Original files before the operation |
| `output` | Delete only | Paths that must be removed from the written retrieve output |

Use `files.match(globs)`, `files.get(path)` and `files.has(path)` to inspect the
active set. File paths are relative to the source root and normalized with `/`.
The read-only `project` and `disk` views expose the same `match`, `get` and
`has` operations.

Every file supports:

- `readBytes()`, `readText()` and `readXml()`;
- the normalized `path` and its `origin` (`disk`, `incoming` or `generated`).

Files from the mutable `files` set additionally support:

- `writeBytes()`, `writeText()` and `writeXml()`;
- `exclude()` to remove the file from this operation;
- `delete()` to remove it from the current output tree.

`readXml()` returns the contents below the XML root. Like Salesforce metadata
parsed elsewhere in `sfdy`, elements are represented as arrays. `writeXml()`
preserves the original root element.

The file set can also include stored project files or create new ones:

```js
async function addGeneratedClass ({ files, project }) {
  const stored = project.get('classes/Shared.cls')
  if (stored && !files.has(stored.path)) files.include(stored)

  if (!project.has('classes/Generated.cls')) {
    files.create({
      path: 'classes/Generated.cls',
      contents: 'public class Generated {}\n'
    })
  }
}
```

`files.exclude(globs)`, `files.excludeWhere(predicate)` and
`files.delete(globs)` operate on multiple paths. `output.delete(globs)` is
useful on retrieve when a renderer must clean an old directory before writing
its new representation.

Deleting a file from the plugin transaction does **not** create a Salesforce
destructive deployment. Destructive changes remain an explicit deploy mode.

### Renderer skeleton

Renderers use the same file model, but must describe both directions:

```js
const { defineRenderer } = require('sfdy/plugin')

module.exports = defineRenderer({
  name: 'custom-renderer',

  resolveSelection ({ selection }) {
    // Expand or replace paths needed to render a partial operation.
  },

  async onRetrieve ({ files, project, output, config }) {
    // Convert Salesforce files into the representation stored in Git.
  },

  async onDeploy ({ files, project, config }) {
    // Rebuild the representation accepted by Salesforce.
  }
})
```

The selection passed to `resolveSelection` exposes `match`, `has`, `include`,
`exclude`, `replace` and `values`. This makes a partial operation behave as if
the user had selected the complete rendered artifact.

See the
[built-in static resource renderer](src/renderers/static-resource-bundle.js)
for a complete implementation covering selection remapping, binary files,
generated files and output cleanup.

### Shared context

All hooks receive the values relevant to their phase plus this shared context:

- `direction`: `retrieve` or `deploy`;
- `format`: `metadata` or `sfdx`;
- `target.environment` and `target.username`;
- `config`: the complete project configuration;
- `log`: `debug`, `info`, `warn` and `error` methods;
- `salesforce`: the authenticated Salesforce client.

The Salesforce client exposes `query`, `rest`, `metadata`,
`describeMetadata`, `listMetadata` and `publishCommunity`. Pass `true` as the
second argument of `query` to use the Tooling API.

Errors are annotated with the extension name and failing hook. XML parse
errors also identify the offending project path.

### TypeScript and Plugin API v1

`sfdy/plugin` ships TypeScript declarations. A typed project-specific config
can be inferred through the helper generic:

```ts
import { definePlugin } from 'sfdy/plugin'

type Config = {
  namespaces: string[]
}

export default definePlugin<Config>({
  name: 'typed-plugin',

  onRetrieve ({ files, config }) {
    files.exclude(config.namespaces.map(namespace =>
      `objects/${namespace}__*/**/*`))
  }
})
```

Compile TypeScript extensions to JavaScript before loading them from
`.sfdy.json`.

Plugin API v1 extensions are still adapted automatically. They now run in the
project representation and emit a deprecation warning because format-dependent
extensions may require migration. API v1 remains supported throughout the 2.x
series and will be removed in `sfdy` 3. See the
[Plugin API v2 migration guide](MIGRATING_PLUGINS_TO_V2.md) for a mechanical
mapping of the old helpers and complete before-and-after examples.

## JavaScript API

The CLI is a thin wrapper around the same public functions used by
`fast-sfdc` and other integrations:

```js
const { convert, deploy, retrieve, transformer, auth, credentials } = require('sfdy')
```

### Deploy programmatically

```js
const path = require('node:path')
const { deploy } = require('sfdy')

const basePath = path.resolve('your-salesforce-project')
const config = {
  sourceFormat: 'sfdx',
  preDeployPlugins: ['sfdy-plugins/environment-endpoints.js'],
  renderers: []
}

const result = await deploy({
  basePath,
  config,
  loginOpts: {
    serverUrl: process.env.SFDY_SERVER_URL,
    clientId: process.env.SFDY_CLIENT_ID,
    clientSecret: process.env.SFDY_CLIENT_SECRET
  },
  diffCfg: 'origin/main..HEAD',
  preDeployPlugins: config.preDeployPlugins,
  renderers: config.renderers,
  checkOnly: true,
  testLevel: 'RunSpecifiedTests',
  specifiedTests: 'AccountServiceTest'
})

if (result.status !== 'Succeeded') process.exitCode = 1
```

Important deploy options are:

- project: `basePath`, `srcFolder`, `sourceFormat`, `config`;
- selection: `files` or `diffCfg`;
- extensions: `preDeployPlugins`, `renderers`;
- behavior: `checkOnly`, `destructive`, `destructivePackage`,
  `ignoreWarnings`, `quickDeploy`;
- tests: `testLevel`, `specifiedTests`, `testReport`;
- output: `logger(message)`.

Plugin and renderer entries can be paths, configuration descriptors or
already imported API v2 definitions.

### Retrieve programmatically

```js
const path = require('node:path')
const { retrieve } = require('sfdy')

const basePath = path.resolve('your-salesforce-project')

await retrieve({
  basePath,
  config: {
    sourceFormat: 'sfdx',
    postRetrievePlugins: ['sfdy-plugins/normalize-retrieve.js'],
    renderers: []
  },
  loginOpts: {
    serverUrl: process.env.SFDY_SERVER_URL,
    clientId: process.env.SFDY_CLIENT_ID,
    clientSecret: process.env.SFDY_CLIENT_SECRET
  },
  meta: 'CustomObject/Account,Profile/Admin',
  logger: console.log
})
```

Use `files` for project-path selection or `meta` for
`MetadataType/fullName` selection. A retrieve resolves after the transformed
files have been written to the source folder.

Both operations accept these authentication shapes in `loginOpts`:

- `serverUrl`, `clientId`, `clientSecret` for OAuth client credentials;
- `instanceUrl`, `refreshToken` and optional client credentials for refresh
  token authentication;
- `username`, `password` and optional `sandbox` for the legacy SOAP login.

The lower-level transformer API additionally accepts an existing
`sessionId`/`instanceHostname` pair.

### Supported package exports

| Export | Purpose |
| --- | --- |
| `sfdy` | `auth`, `credentials`, `deploy`, `retrieve`, `transformer` |
| `sfdy/plugin` | Plugin API v2 helpers, file model, selections and TypeScript types |
| `sfdy/credentials` | Shared encrypted project credential vault |
| `sfdy/deploy`, `sfdy/retrieve` | Direct operation imports |
| `sfdy/transformer` | Local transform and untransform operations |
| `sfdy/auth` | Interactive OAuth web-server flow |
| `sfdy/format-adapters` | Project-format resolution and adapters |
| `sfdy/package-utils` | Manifest and metadata mapping utilities |
| `sfdy/sfdc-utils` | Authenticated low-level Salesforce client factory |
| `sfdy/xml-utils` | XML parsing and serialization utilities |
| `sfdy/path-service`, `sfdy/constants` | Project paths and shared constants |

## Where sfdy fits

`sfdy` is not a replacement for every Salesforce CLI command, and it does not
try to manage the complete Salesforce development lifecycle.

Use Salesforce CLI when you need its broad platform capabilities, such as
scratch-org lifecycle management, packaging or data operations.

Use `sfdy` when you want a focused and dependable metadata delivery engine:

- your Git repository is the source of truth;
- deployments must behave consistently from a laptop to production;
- your pipeline should deploy only what changed;
- metadata requires normalization between orgs and source control;
- you want to extend the workflow with ordinary JavaScript;
- you value a small maintenance surface over a large feature surface.

## Documentation

- [Standard patches and built-in renderers](STANDARD_PATCHES.md)
- [fast-sfdc on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=m1ck83.fast-sfdc)
- [Salesforce Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_intro.htm)
- [MIT license](LICENSE)
