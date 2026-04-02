---
name: update-version
description: 'Use when updating the app version for a reviewed release or invoking /update-version <version>. Validates the requested version against package.json and the latest git tag, updates package.json and package-lock.json, summarizes changes since the previous tagged commit, commits the version bump, and pushes an annotated release tag.'
argument-hint: '<target-version>'
disable-model-invocation: true
---

# Update Version

Use this skill for release-style version bumps such as `/update-version 0.0.3-alpha`.

Invoking this skill means the release has already been reviewed and is ready to ship. The default behavior is to bump the version, commit it, create the annotated `v<target-version>` tag, and push the branch and tag so downstream GitHub Actions can run. Do not wait for an additional confirmation before tagging unless the user explicitly asks for a PR-only or no-tag workflow.

## Inputs

- Required argument: the target version string, for example `0.0.3-alpha`

## Workflow

1. Validate the target version and inspect the repo state by running [release-info](./scripts/release-info.mjs):

   ```bash
   node .github/skills/update-version/scripts/release-info.mjs <target-version>
   ```

   The script reports:
   - `currentVersion` from `package.json`
   - `lockfileVersion` from `package-lock.json`
   - `latestTag` and normalized `latestTagVersion`
   - whether the target is greater than both the current version and the latest tag
   - the git range to summarize in the release summary

2. Stop immediately if:
   - the argument is missing
   - the target version is not valid semver/prerelease syntax
   - the target version is not greater than `package.json`'s current version
   - the target version is not greater than the latest existing git tag

3. Create or switch to a release branch named after the target, for example:

   ```bash
   git switch -c chore/release-v<target-version>
   ```

   If the branch already exists, switch to it instead of failing.

4. Update the versioned package manifests with npm so `package.json` and `package-lock.json` stay in sync:

   ```bash
   npm version <target-version> --no-git-tag-version
   ```

5. Verify that both manifests now match the requested version:
   - `package.json`
   - `package-lock.json` root package version

6. Summarize all changes since the previous tagged commit using the range reported by the helper script. Prefer commit subjects in chronological order:

   ```bash
   git --no-pager log --reverse --pretty=format:'- %s (%h)' <latest-tag>..HEAD
   ```

   If there is no prior tag, summarize the repository history instead.

7. Run the existing repo checks before pushing the release:

   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```

8. Stage and commit the version bump with a release-oriented message such as:

   ```bash
   git add package.json package-lock.json
   git commit -m "chore: bump version to v<target-version>"
   ```

9. Create an annotated release tag from the version bump commit and push both the branch and tag:
   - `git tag -a v<target-version> -m "v<target-version>"`
   - `git push -u origin HEAD`
   - `git push origin v<target-version>`

10. Report back with:
    - the branch name
    - the release commit SHA
    - the pushed tag name
    - the collected change list since the previous tag
    - the validation commands that passed or failed

11. Optional PR handling:
    - Only open a PR if the user explicitly asks for one.
    - If a PR is requested, use a release-oriented title such as `chore: release v<target-version>` and include the version summary, collected changes, and validation results.

## Notes

- This repository currently has a known mismatch risk between `package.json` and `package-lock.json`; always verify both after `npm version`.
- Existing tags in this repo use a leading `v`, for example `v0.0.2-alpha`.
