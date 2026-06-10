# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
It drives versioning, the per-package `CHANGELOG.md`, and the release git tag for
this monorepo — replacing the old conventional-commits / release-it flow.

## Authoring a changelog entry

In any PR that should appear in the release notes, run:

```bash
bun run changeset
```

Pick the affected package(s) and a bump (`patch` / `minor` / `major`), then write
the human-readable note. This creates a markdown file in `.changeset/` — commit it
with your PR. Example:

```markdown
---
"@fressh/mobile": minor
---

Add ED25519 key import to the key manager.
```

## How a release happens

1. PRs land on `main` carrying their changeset files.
2. The **Release** workflow opens/updates a **"Version Packages"** PR that bumps
   `package.json`, rewrites `CHANGELOG.md`, and consumes the changeset files.
3. Merging that PR lands the bumped version and (because `privatePackages.tag` is
   on) creates the `@fressh/mobile@<version>` git tag — the hand-off point for the
   build/release track.

`apps/mobile` is `"private": true`, so changesets versions + tags it but never
publishes it to npm.

See `docs/projects/ci-building-and-releasing.md` for the full plan.
