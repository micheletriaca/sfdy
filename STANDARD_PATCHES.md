# Standard patches and built-in renderers

Salesforce metadata is not always a stable source-control representation.
Retrieves can omit disabled permissions, include ineffective entries, return
references to components that are not versioned, and expose metadata generated
by managed packages or platform features.

`sfdy` ships a small set of standard patches for turning that response into the
representation a repository intends to own. Every configurable patch is
opt-in. They are part of the core runtime and are enabled with keys in
`.sfdy.json`; they must not be added to `postRetrievePlugins`.

## Lifecycle

Standard patches operate on Metadata API paths and XML. This remains true for
SFDX projects: retrieved metadata is patched before the source-format adapter
writes it to the project.

```text
retrieve: Salesforce -> standard patches -> source adapter -> project -> disk
prepare:  project -> metadata representation -> standard patches -> project
deploy:   project -> custom pre-deploy plugins -> Salesforce
```

The patches therefore normalize retrieved or locally prepared files. They do
not unexpectedly change the repository or deployment payload during an
ordinary deploy. The built-in static-resource renderer is the exception: as a
renderer, it deliberately expands archives on retrieve and rebuilds them on
deploy.

Patches that need org data are skipped before their hooks and queries when the
corresponding configuration is inactive or no Profile is present in the
current payload.

## Starting configuration

`sfdy create` writes only the project format and API version. Add patch keys as
the repository adopts each normalization:

```json
{
  "sourceFormat": "sfdx",
  "apiVersion": "65.0",
  "objectTranslations": {
    "stripUntranslatedFields": true,
    "stripNotVersionedFields": true
  },
  "profiles": {
    "addAllUserPermissions": true,
    "addDisabledVersionedObjects": true,
    "addExtraObjects": ["Account", "Lead", "External_*"],
    "addExtraTabVisibility": ["standard-*", "Custom_*"],
    "addExtraApplications": ["standard__*", "Custom_*"],
    "stripUserPermissionsFromStandardProfiles": true,
    "stripUnversionedStuff": true
  },
  "roles": {
    "stripPartnerRoles": true
  },
  "staticResources": {
    "useBundleRenderer": ["*"]
  },
  "stripManagedPackageFields": ["managed_namespace__"]
}
```

Arrays used for objects, tabs, applications and static resources accept glob
patterns, including negated patterns such as `!standard__*`. Patterns are
evaluated in order with `multimatch` semantics.

`sfdy init` remains available as a shortcut for generating an opinionated
Metadata API starter configuration with most patches enabled. It overwrites
`.sfdy.json`; do not run it over a configuration you need to preserve.

## Filtering and repository-scope patches

These patches use only the retrieved payload and local project inventory.

| Configuration | Affects | Effect |
| --- | --- | --- |
| `objectTranslations.stripUntranslatedFields` | `Translations`, `CustomObjectTranslation`, `StandardValueSetTranslation` | Removes translation entries whose relevant label, description, help text or translated value is empty. |
| `objectTranslations.stripNotVersionedFields` | `CustomObjectTranslation` | Removes translated fields whose corresponding object field is not represented in the project. |
| `profiles.stripUserPermissionsFromStandardProfiles` | `Profile` | Removes `userPermissions` and `objectPermissions` from standard Profiles because those values are not editable and tend to change between Salesforce releases. Custom Profiles are untouched. |
| `profiles.stripUnversionedStuff` | `Profile` | Keeps field permissions, class/page accesses and layout assignments only when the referenced field, class, page or layout exists in the project inventory. |
| `roles.stripPartnerRoles` | `Role` | Excludes generated role files ending in `PartnerUser<number>.role`. Salesforce creates them for partner accounts and they normally should not be versioned. |
| `stripManagedPackageFields` | `CustomObject`, `PermissionSet`, `Profile` | Accepts an array of namespace prefixes. Removes matching fields and web links, managed picklist references in record types, and matching field permissions. |

The unversioned-content patches depend on the repository being the intended
source of truth. Enable them only when absence from the project really means
that the component should not be represented in the normalized metadata.

## Profile completion patches

Salesforce omits some disabled Profile settings from Metadata API responses.
These patches reconstruct a complete, deterministic representation. They make
SOQL, Tooling API or REST calls only when enabled and when Profiles are part of
the current operation.

| Configuration | Org access | Effect |
| --- | --- | --- |
| `profiles.addAllUserPermissions` | SOQL and REST | For custom Profiles, replaces `userPermissions` with the complete permission list, including disabled values that Metadata API omitted. |
| `profiles.addDisabledVersionedObjects` | SOQL | Adds all-false `objectPermissions` for project objects that are available to the Profile license but absent because access is completely disabled. |
| `profiles.addExtraObjects` | SOQL | Accepts object API-name globs. Includes object permissions for matching objects even when their object metadata is not maintained by the repository. Existing permissions are preserved; missing access is represented explicitly. |
| `profiles.addExtraTabVisibility` | SOQL and Tooling API | Accepts tab API-name globs. Completes `tabVisibilities` for matching tabs, versioned tabs and tabs belonging to versioned objects, using `Hidden` when Salesforce returns no setting. |
| `profiles.addExtraApplications` | Additional metadata dependency | Accepts application API-name globs. Retrieves application metadata needed while normalizing Profiles and retains matching or versioned `applicationVisibilities`. |

Profile filenames returned by Metadata API do not always match their display
names. The completion patches remap standard Profile names before querying the
underlying PermissionSet records.

## Automatic retrieve dependencies

The always-on dependency planner does not modify repository output. It only
requires related metadata while patches are running:

- retrieving a Profile may also retrieve locally versioned applications,
  classes, pages, objects, fields, record types, tabs, custom permissions,
  layouts, data category groups and external data sources;
- retrieving an object translation may also retrieve its object, fields and
  layouts.

Required-only components are discarded unless they were part of the original
selection. This gives patches enough context without silently expanding what
is written to disk.

## Expanded static-resource bundles

The built-in renderer is configured with
`staticResources.useBundleRenderer`. It is available only in Metadata API
projects because SFDX already has a native expanded static-resource
representation.

```json
{
  "staticResources": {
    "useBundleRenderer": ["PortalAssets.resource", "Shared*"]
  }
}
```

For matching resources whose descriptor declares `application/zip`, retrieve
removes the binary `.resource` archive and writes its contents below
`staticresources/<resource-name>/`. Deploy rebuilds the ZIP in memory. A
partial selection inside that folder resolves to the complete static resource,
so the rebuilt archive remains valid.

Archive entries are path-validated while expanding to prevent files from
escaping the resource directory.

## Custom plugins alongside standard patches

Custom plugins are configured separately and run sequentially in their listed
order:

```json
{
  "postRetrievePlugins": [
    "sfdy-plugins/normalize-retrieve.js"
  ],
  "preDeployPlugins": [
    {
      "path": "sfdy-plugins/environment-values.js",
      "stage": "metadata",
      "formats": ["metadata", "sfdx"]
    }
  ],
  "renderers": [
    "sfdy-renderers/custom-representation.js"
  ]
}
```

Paths are resolved from the project root. String entries use the stage and
formats declared by the module; object entries can override them.

- `postRetrievePlugins` normalize or enrich incoming metadata;
- `preDeployPlugins` adapt metadata for a target org and do not run during
  destructive deployments;
- `renderers` maintain a reversible repository representation and run in both
  directions.

Use a metadata-stage plugin when it should be independent of the repository
format:

```js
const { definePlugin } = require('sfdy/plugin')

module.exports = definePlugin({
  name: 'remove-generated-values',
  stage: 'metadata',
  formats: ['metadata', 'sfdx'],

  enabled: ({ config, files }) =>
    config.removeGeneratedValues === true &&
    (!files || files.match('objects/**/*').length > 0),

  async onRetrieve ({ files }) {
    for (const file of files.match('objects/**/*')) {
      const object = await file.readXml()
      object.generatedValues = []
      await file.writeXml(object)
    }
  }
})
```

See the [Extending sfdy](README.md#extending-sfdy) section for the complete
Plugin API, lifecycle, selection planning, renderer contract and TypeScript
types.
