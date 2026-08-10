# Changelog

This file records user-visible changes to `sfdy`. Historical entries through
1.8.1 were recovered from the original README and lightly edited for clarity.
Git tags remain the authoritative record for older package versions.

## [2.0.0] - Unreleased

### Added

- Salesforce DX source-format projects, including decomposed objects and
  translations, static resources, folder metadata, bundles and partial
  component selection.
- Plugin API v2 with typed public exports, explicit lifecycle hooks,
  transactional file operations, retrieve planning, project and metadata
  stages, format guards and cheap `enabled` predicates.
- Project-local encrypted credential vault shared by the CLI and fast-sfdc,
  backed by the operating-system keychain when available.
- `sfdy create` for detecting or scaffolding a project, authenticating and
  running the first retrieve.
- OAuth 2.0 client credentials for unattended CI/CD authentication.
- Public JavaScript subpath exports for supported integrations.

### Changed

- Node.js 22 or newer is now required.
- `package.xml` is optional. Deploy and retrieve manifests can be built from
  the selected files or local project inventory.
- Plugin API v1 extensions run through a compatibility adapter, emit a
  deprecation warning and run in the project representation. They remain
  supported throughout 2.x and will be removed in sfdy 3.
- Deploy and retrieve use the native Fetch API and stream large Metadata API
  payloads instead of buffering them unnecessarily.
- Built-in patches use Plugin API v2 and skip their work before performing
  queries or file processing when they are not active.
- Authentication targets must be selected explicitly or interactively; there
  is no implicit current target.
- GitHub Actions test Node.js 22 and 24.

### Removed

- The obsolete `permissionSets.stripUselessFls` standard patch.
- Private `sfdy/src/*` imports as a supported integration API. Use the package
  root or documented public subpath exports instead.

### Fixed

- Partial deploys that contain no deployable files now finish cleanly.
- Source-format selection preserves container and child metadata semantics.
- Metadata folders, nested territory components, partial Custom Labels and
  source-format static resources are mapped correctly.
- Streaming deploys and quick-deploy polling report results consistently.

## [1.8.1] - 2025-06-13

- Identify the corrupted file when an XML transformation fails.
- Update dependencies to address a minor vulnerability.

## [1.8.0] - 2025-02-13

- Handle Digital Experience metadata.

## [1.7.8] - 2024-02-20

- Fix profile retrieval when a profile name contains an apostrophe.

## [1.7.7] - 2023-11-24

- Fix quick-deploy polling.

## [1.7.6] - 2023-11-24

- Fix quick-deploy polling.

## [1.7.5] - 2023-11-22

- Print the deployment ID.
- Improve error reporting for corrupt `package.xml` files.

## [1.7.4] - 2023-05-08

- Minor bug fixes.

## [1.7.3] - 2023-04-14

- Minor bug fixes.

## [1.7.2] - 2023-04-14

- Handle `Territory2*` metadata, whose naming differs from other metadata.
- Update dependencies to address vulnerabilities.

## [1.7.1] - 2023-03-19

- Add `--ignoreWarnings` to allow deploy warnings without failing the deploy.
- Correct documentation typos.

## [1.7.0] - 2023-02-28

- Add `community:publish` for publishing an Experience Cloud bundle after a
  deployment.
- Add `--quick-deploy=deploymentId`.

## [1.6.5] - 2022-08-31

- Follow instance URL redirects to the newer `*.sandbox.my.salesforce.com`
  domains during OAuth 2.0 authentication.

## [1.6.4] - 2022-05-30

- Make broad file selection and Permission Set retrieval faster.
- Add the `web` OAuth scope.

## [1.6.3] - 2022-04-12

- Fix the plugin context when OAuth 2.0 authentication is used.

## [1.6.2] - 2022-04-11

- Fix SOAP login.

## [1.6.1] - 2022-04-11

- Minor bug fixes.

## [1.6.0] - 2022-04-08

- Add the OAuth 2.0 web-server flow for obtaining refresh tokens, including
  orgs where MFA is enabled.

## [1.5.4] - 2022-04-07

- Minor bug fixes.

## [1.5.3] - 2021-08-26

- Minor bug fixes.

## [1.5.2] - 2021-08-24

- Show resolved files instead of raw glob patterns when `--files` is used.
- Support braces in glob expressions and give negated patterns precedence.
- Fix retrieval of foldered metadata when `--meta` is used.

## [1.5.1] - 2021-07-26

- Fix deployment of static-resource bundles.

## [1.5.0] - 2021-07-21

- Add `excludeFiles` for omitting selected project files from deployment.
- Update dependencies to address vulnerabilities.

## [1.4.7] - 2021-04-26

- Fix another regression in foldered metadata handling.

## [1.4.6] - 2021-04-02

- Fix a regression in foldered metadata handling.

## [1.4.5] - 2021-03-26

- Support multiple metadata types in the same folder, including Wave
  metadata.

## [1.4.4] - 2021-03-14

- Accept either a `package.xml` file or a glob for destructive deployments.
- Fix `--diff` when the diff contains only files outside the source folder.

## [1.4.3] - 2021-03-09

- Fix exclusion glob patterns used with `--files`.

## [1.4.2] - 2021-02-28

- Fix ExperienceBundle deployment.

## [1.4.1] - 2020-11-09

- Fix `--diff` deployment of reports in nested folders.

## [1.4.0] - 2020-09-20

- Add the Transformer API for loading unrendered files in memory.

## [1.3.6] - 2020-07-02

- Allow `--diff` and `--files` to be used together.

## [1.3.5] - 2020-07-02

- Handle a Git diff with no changes inside the source folder.

## [1.3.4] - 2020-07-02

- Fix delta deployment of foldered metadata such as Reports, Documents, Email
  Templates and Dashboards.

## [1.3.3] - 2020-04-27

- Accept exact paths for files not currently present on disk with `--files`.

## [1.3.2] - 2020-04-26

- Clean up the inactive side of the static-resource bundle representation.
- Improve the README.

## [1.3.1] - 2020-04-23

- Improve the README.

## [1.3.0] - 2020-04-23

- Add `addRemapper`, `addFiles` and `cleanFiles` to the extension helpers.
- Add the static-resource bundle renderer.

## [1.2.0] - 2020-04-10

- Add destructive deployment support.
- Improve the README.

## [1.1.0] - 2020-04-02

- First documented release.
