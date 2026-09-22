# Release publish attempt

This records the exact commands and outputs of the publish step, because a
release that could not be performed must not be described as if it were.

**Observed 2026-09-22 on this machine. `@agentkit/render` remains unpublished.**

## Registry authentication

```console
$ npm whoami
npm error code E401
npm error 401 Unauthorized - GET https://registry.npmjs.org/-/whoami
npm error A complete log of this run can be found in: /home/orca/.npm/_logs/2026-09-22T04_59_41_936Z-debug-0.log
```

There is no authenticated npm session here, so `npm publish` cannot succeed. This
is the pre-declared boundary, not a surprise: the epic recorded it before the
work started.

## What the publish would ship

The dry run packs the real tarball and reports exactly what a real publish would
upload. It does not require credentials, which is why it is the useful half of
this record.

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
npm notice Publishing to https://registry.npmjs.org/ with tag next and public access (dry-run)
+ @agentkit/render@0.1.0
```

`0.1.0` carries no prerelease identifier, so a real publish would take the
`latest` dist-tag rather than `next`. The tag shown here is the prerelease path
exercised deliberately to confirm the workflow's tag selection.

## How the release is performed

`.github/workflows/release.yml` owns it. Pushing a `v*` tag:

1. verifies the tag, `package.json` `version`, and `src/version.ts` `VERSION`
   all agree, so a mistyped tag cannot publish the wrong version;
2. runs lint, typecheck, build, unit tests, `schema:check`, `snapshots:check`,
   `gallery:check`, the browser suite, the package smoke test, and the
   clean-install verification against the packed tarball;
3. publishes with `npm publish --provenance --access public --tag <latest|next>`,
   where the tag is `next` for a version with a prerelease identifier;
4. extracts the changelog section for that version and creates the GitHub
   release from it with `--verify-tag`.

Provenance is produced through OIDC (`id-token: write`), so the published
artifact is bound to the workflow run that built it. The job needs an
`NPM_TOKEN` secret with publish rights; without it the publish step fails with
the same 401 recorded above.

## What is verified before publishing

The clean-install check is the consumer-side proof, and it already passes
against the packed tarball from this checkout:

```console
$ pnpm test:clean-install
clean-install-verify OK: @agentkit/render@0.1.0 installed from agentkit-render-0.1.0.tgz; JSON and YAML compiled, byte-identical to local, opened over file:// with 0 external requests
```

So the only missing step is registry credentials. Nothing about the artifact is
unverified; the publish itself is what is blocked.

## Claim status

| Claim | Status |
| --- | --- |
| The release workflow is prepared and complete | Delivered, in `.github/workflows/release.yml` |
| The blocked command and its output are recorded | Delivered, in this file |
| The tarball is consumer-verified | Delivered, `pnpm test:clean-install` |
| `@agentkit/render` is published | **Not done.** No npm auth on this machine. |
| A version is tagged with provenance | **Not done.** Requires a successful publish. |

Do not read this file as a release announcement.
