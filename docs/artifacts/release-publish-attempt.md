# Release publish attempt

This records the exact commands and outputs of the publish step, because a
release that could not be performed must not be described as if it were.

**Observed 2026-09-22. `@agentkit/render` is still not published.**

## Attempt 2 — authenticated, blocked on scope permission

The maintainer session is now authenticated, so the earlier `E401` no longer
applies. The publish still cannot complete, for a different and more specific
reason.

```console
$ npm publish --access public --tag latest --provenance=false
npm notice name: @agentkit/render
npm notice version: 0.1.0
npm notice filename: agentkit-render-0.1.0.tgz
npm notice package size: 132.6 kB
npm notice unpacked size: 589.7 kB
npm notice shasum: 535ffd166ff395f2a3881cb1052b35aca979672c
npm notice total files: 140
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/@agentkit%2frender - Not found
npm error 404  '@agentkit/render@0.1.0' is not in this registry.
```

npm answers `404` on a `PUT` to a scope the caller cannot publish into, rather
than `403`, so the registry does not disclose whether the scope exists.

The account's own permissions make the cause clear:

```console
$ npm org ls agentkit --json
{}
$ npm access list packages
@bestagentkits/ak: read-write
@bestagentkits/build-with-ak: read-write
... (other scopes) ...
```

The account holds `read-write` on `@bestagentkits/*` and several other scopes,
and holds nothing on `@agentkit`. So the block is **scope ownership**, not
authentication and not the package contents.

### What resolves it

Either:

1. **Join the org that owns `@agentkit`.** If the scope is already owned by
   another npm account or org, add this account as a member with publish rights.
2. **Claim the scope.** If `agentkit` is an unclaimed npm org name, create it at
   `https://www.npmjs.com/org/create` with the publishing account; the scope then
   belongs to that account.

If neither is possible because the scope is held by an unrelated party, the
package name has to change, which is a real change: it appears in the README,
the CLI docs, the AgentKit `ak:render` skill, and the composition contract.

## Provenance note for the first publish

`package.json` sets `publishConfig.provenance: true`, which requires an
OIDC-capable CI environment. This first publish was attempted with
`--provenance=false` deliberately: trusted publishing cannot be configured on a
package that does not exist yet, so the first version has to be published before
OIDC can take over.

**0.1.0 therefore ships without provenance if published this way.** Every later
release publishes from `.github/workflows/release.yml` with
`--provenance` over GitHub OIDC, which is the durable arrangement. Record the
gap for 0.1.0 rather than implying provenance it does not have.

## What the publish would ship

```console
$ npm publish --provenance --access public --tag next --dry-run
npm notice Tarball Details
npm notice name: @agentkit/render
npm notice version: 0.1.0
npm notice filename: agentkit-render-0.1.0.tgz
npm notice package size: 132.6 kB
npm notice unpacked size: 589.7 kB
npm notice shasum: 535ffd166ff395f2a3881cb1052b35aca979672c
npm notice integrity: sha512-ZdcTH/wflfXQl[...]mxuzAwEOc5p0g==
npm notice total files: 140
```

## Consumer-side verification

The packed tarball is verified as a consumer before any publish is attempted:

```console
$ pnpm test:clean-install
clean-install-verify OK: @agentkit/render@0.1.0 installed from agentkit-render-0.1.0.tgz; JSON and YAML compiled, byte-identical to local, opened over file:// with 0 external requests
```

## Claim status

| Claim | Status |
| --- | --- |
| The release workflow is prepared and complete | Delivered, `.github/workflows/release.yml` |
| The workflow authenticates through trusted publishing | Delivered: OIDC only, no stored token |
| The blocked command and its output are recorded | Delivered, this file |
| The tarball is consumer-verified | Delivered, `pnpm test:clean-install` |
| `@agentkit/render` is published | **Not done.** Blocked on `@agentkit` scope permission. |
| A version is tagged with provenance | **Not done.** Follows a successful publish. |

Do not read this file as a release announcement.
