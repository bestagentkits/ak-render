# Release publish

The record of what shipped to the npm registry, what was verified, and what
remains. A release claim needs the artifact, so this file names the exact
published identity rather than describing an intention.

## Published

| Fact | Value |
| --- | --- |
| Package | `@bestagentkits/render` |
| Version | `0.1.0` |
| Dist-tag | `latest` |
| Published | 2026-09-22T06:10:34.816Z |
| Tarball | `https://registry.npmjs.org/@bestagentkits/render/-/render-0.1.0.tgz` |
| shasum | `3ddaef4d87258aa77435ea80924a7304683a7767` |
| integrity | `sha512-BoGoO8ZJEEeWhz2JmMmudYiwOltork2AWYiIiiLOxN7gKk68a9hcGk/hmSNxFVWvSSIakX825U8kg1Y47xzITA==` |
| Files | 140 |
| Unpacked | 589825 bytes |
| License | MIT |
| Repository | `git+https://github.com/bestagentkits/ak-render.git` |
| Source commit | `bd101bb` |

The published shasum is byte-identical to the tarball built from the tree at
`bd101bb`, so the artifact and the repository agree at that commit. The tree has
since moved forward in documentation only: the `0.1.0` CHANGELOG section was
added after the publish, because the release job extracts its notes from that
section and the tag cannot be pushed without it. Rebuilding the tarball from the
current tree therefore yields a different shasum, which reflects the CHANGELOG
edit and nothing else.

## How it was published, and why not through CI

The first version of a package cannot be published by trusted publishing. npm
configures a trusted publisher on a package's settings page, which does not
exist until the package does, and the trusted-publisher documentation describes
OIDC as working *in addition to* traditional authentication. The first publish
therefore had to be a manual, authenticated one.

```console
$ npm publish --access public --tag latest --provenance=false
npm notice name: @bestagentkits/render
npm notice version: 0.1.0
npm notice shasum: 3ddaef4d87258aa77435ea80924a7304683a7767
npm notice total files: 140
```

Two consequences to keep honest:

- **`0.1.0` has no provenance attestation.** `--provenance=false` was required
  because a local publish has no OIDC environment to attest from. Every later
  release publishes from `.github/workflows/release.yml` with `--provenance`
  over GitHub OIDC.
- **The publish required a 2FA one-time password** from the maintainer's
  authenticator. `--auth-type=web` is not accepted for publish on this account;
  npm answers `EOTP` either way.

## Verification of the published artifact

The checks below ran against the package installed **from the registry**, not
against the local checkout, so they describe what a consumer receives.

| Check | Observed |
| --- | --- |
| Registry shasum equals the locally built tarball | Match, `3ddaef4d…` |
| Install from the registry | `@bestagentkits/render 0.1.0` |
| Library import | `PACKAGE_NAME`/`VERSION` resolve to `@bestagentkits/render 0.1.0` |
| CLI | `ak-render --version` prints `0.1.0` |
| Compile a YAML Page Spec | 24839 bytes, 2 runtime features |
| Compile a JSON Page Spec | 22709 bytes, 1 runtime feature |
| `ak-render validate` | Accepts the valid spec; rejects unknown props and malformed items |
| Exactly one `<h1>` | Yes |
| External `src`/`href` | None, in both artifacts |
| Policy-derived CSP and nonce | Present |
| Inline event handlers | None |
| Generator label | `@bestagentkits/render 0.1.0` |
| Opened over `file://` in chromium | 0 external requests, 0 console errors |
| Rendered content and runtime | 3 list items, theme toggle wired |

## Earlier attempts and the scope block

Recorded because a release that could not be performed must not be described as
if it were, and because the resolution changed the package name.

1. **`E401 Unauthorized`** — no authenticated session.
2. **`404` on `PUT https://registry.npmjs.org/@agentkit%2frender`** — the session
   was authenticated, but the account held `read-write` on `@bestagentkits/*` and
   nothing on `@agentkit`. npm answers `404` for a scope the caller cannot publish
   into. The `@agentkit` scope was not available to this account, and the
   AgentKit monorepo's own `@agentkit/*` workspace packages are private and
   unrelated, so claiming the scope was not an option.
3. **The package was renamed to `@bestagentkits/render`**, the scope the
   publishing account owns, across both the compiler repository and the AgentKit
   skills that document its commands.
4. **`EOTP`** — the manual publish needed a one-time password, which the
   maintainer supplied.

## What remains

The trusted publisher still has to be configured on npmjs.com, on the package's
own settings page. Until then, publishing from CI is not yet authorized:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `bestagentkits` |
| Repository | `ak-render` |
| Workflow filename | `release.yml` |
| Environment name | *(blank)* |
| Allowed actions | **`npm publish` must be selected** |

The allowed-actions choice is the one that fails silently: configurations created
after 2026-09-03 default to `npm stage publish` only, and `release.yml` publishes
directly, so an unselected checkbox turns every release job red.

Recommended afterwards: **Settings → Publishing access → Require two-factor
authentication and disallow tokens**, so the only path that can publish is the
OIDC one.

## Claim status

| Claim | Status |
| --- | --- |
| `@bestagentkits/render@0.1.0` is published under `latest` | **Done**, verified from the registry |
| The published tarball matches the committed tree | **Done**, shasum match |
| A consumer can install, compile, and open the artifact offline | **Done**, verified from the registry |
| `0.1.0` carries a provenance attestation | **Not done**, and not achievable for a first manual publish |
| Future releases publish through OIDC with provenance | Prepared in `release.yml`; **awaits the trusted-publisher configuration** |
| A version tag and GitHub release exist | Pending the tag push |
