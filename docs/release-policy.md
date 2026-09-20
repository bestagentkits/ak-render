# Release policy

`@agentkit/render` is published to the public npm registry. This document owns
how a version is chosen, how it is built, and what a version change promises.

## Compatibility contract

The package follows Semantic Versioning, with these specifics:

- **Patch** — bug fixes and fixture corrections that do not change the emitted
  HTML for a previously valid spec, or that fix output to match documented
  behavior.
- **Minor** — new blocks, widgets, actions, theme presets, catalog entries,
  CLI subcommands, or options; new spec fields accepted; new diagnostic codes.
  Existing valid specs must keep rendering, and their emitted bytes should only
  change when a bug fix or a documented determinism correction requires it.
- **Major** — removing or renaming a spec field, block type, action, option,
  CLI command, or export; changing emitted semantics for an unchanged spec in a
  way a consumer would observe; tightening validation so a previously valid
  spec is rejected.

Because output is deterministic, an emitted-bytes change is a real change: note
it in the release notes whenever a patch or minor alters output for a spec that
was valid before.

### Page Spec schema versions

The spec carries its own `version` field, independent of the package version.
Schema migrations are additive and shipped with the compiler; a spec that
declares an older supported version keeps working until that version reaches
its announced removal. Removing a schema version is a major release.

### Runtime targets

Node `>=20.11` on Linux, macOS, and Windows is the supported matrix for the
library and CLI. The emitted artifact targets evergreen browsers and does not
depend on a bundler, a server, or the network.

## Version source of truth

`package.json` `version` and `src/version.ts` `VERSION` must match; a unit test
enforces this. A release that updates one without the other fails CI.

## Pre-1.0 expectations

While the package is `0.x`, minor releases may still include changes that would
otherwise be major; each such change is called out explicitly in the changelog.
`0.x` is not a promise that the schema is final — it is a promise that breaking
changes are documented.

## Prereleases

Prereleases are published under the `next` dist-tag and use SemVer prerelease
identifiers, for example `0.2.0-next.1`. `latest` moves only on a stable
release.

## Release procedure

1. Confirm `main` (or the release branch) is green in CI.
2. Update `CHANGELOG.md` and bump both version locations.
3. Build from a clean checkout: `pnpm install --frozen-lockfile && pnpm build`.
4. Verify the artifact as a consumer:
   `pnpm test:package` (packs, installs into a temp project, imports the
   library, runs the bin).
5. Publish with provenance enabled. The repository sets
   `publishConfig.provenance`, so publishing requires either an OIDC-capable CI
   environment (preferred) or an authenticated maintainer session.
6. Tag the released commit (`vX.Y.Z` or `vX.Y.Z-next.N`) and attach the
   changelog section as the release notes.
7. Verify the published tarball from a clean temporary project before announcing
   the release.

Steps 5 through 7 require registry credentials that the repository does not
hold. When credentials are unavailable, prepare the release (changelog, version
bump, workflow, dry-run pack) and record the exact blocked command and its
output; never describe an unpublished version as released.

## Deprecation

A deprecated block, action, option, or CLI command is announced in the changelog
at least one minor release before removal, must still work until removal, and
must emit a diagnostic when used in a spec that can be migrated. Silent
removal is not permitted.
