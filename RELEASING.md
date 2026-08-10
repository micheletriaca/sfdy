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

1. Start a `release/<version>` branch from an up-to-date `master` with a green
   CI run.
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

7. Commit the version and changelog together, push the release branch and open
   a pull request into `master`.
8. Wait for every required CI check to pass, then merge the pull request.
9. Update the local `master`, create an annotated tag on the merge commit and
   push the tag:

   ```bash
   git switch master
   git pull --ff-only origin master
   git tag -a v2.0.0 -m "v2.0.0"
   git push origin v2.0.0
   ```

## Publish

Create a draft GitHub Release from the tag. Copy the matching `CHANGELOG.md`
section into the release description and edit it for readability rather than
relying on a raw commit list. Publish the release only after confirming that
the tag points to the merge commit and the CI run for that commit is green.

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
