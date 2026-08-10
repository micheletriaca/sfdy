# Releasing sfdy

Releases are deliberately explicit. A GitHub Release is the public release
note and triggers npm publication; an ordinary push or tag does not publish a
package.

## One-time npm setup

Configure `sfdy` on npm with a GitHub Actions trusted publisher:

- organization or user: `micheletriaca`;
- repository: `sfdy`;
- workflow filename: `release.yml`;
- environment: leave empty unless the workflow is later assigned one.
- allowed action: `npm publish`.

The workflow uses GitHub's OpenID Connect identity and does not require a
long-lived `NPM_TOKEN` secret.

## Prepare a release

1. Start from a clean `master` branch with a green CI run.
2. Choose the version according to semantic versioning.
3. Set the same version in `package.json` and `package-lock.json`:

   ```bash
   npm version 2.0.0 --no-git-tag-version
   ```

4. Move the relevant notes from `Unreleased`, or replace the `Unreleased`
   marker on the pending version, with the release date in `CHANGELOG.md`.
5. Check that breaking changes include an upgrade or migration path.
6. Run the local release checks:

   ```bash
   npm ci
   npm test
   npm pack --dry-run
   ```

7. Commit the version and changelog together.
8. Create and push an annotated tag matching `package.json`:

   ```bash
   git tag -a v2.0.0 -m "v2.0.0"
   git push origin master v2.0.0
   ```

## Publish

Create a GitHub Release from the tag. Copy the matching `CHANGELOG.md` section
into the release description and edit it for readability rather than relying
on a raw commit list.

Publishing the GitHub Release starts `.github/workflows/release.yml`. The
workflow:

1. checks that the tag and package version match;
2. installs from the lockfile and runs the complete test suite;
3. inspects the npm package contents;
4. publishes the public package. npm generates its provenance automatically
   from the trusted GitHub identity.

If publication fails, fix the cause and rerun the failed GitHub Actions job.
Do not create a second tag for the same version.

## Verify

After the workflow completes:

```bash
npm view sfdy version
npx --yes sfdy@2.0.0 --version
```

Check that the GitHub Release, npm version and Git tag all identify the same
commit. Add a fresh `Unreleased` section to `CHANGELOG.md` in the next change.
