# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release mechanics and the compatibility contract live in
[docs/release-policy.md](./docs/release-policy.md).

## [Unreleased]

## [0.1.1-next.1] - 2026-09-22

Prerelease published to exercise the trusted-publishing release path end to end:
the tag run publishes over GitHub OIDC with provenance and no stored token. No
functional changes; the compiler behaves as `0.1.0`.

## [0.1.0] - 2026-09-22

First public release, published to npm as `@bestagentkits/render`.

### Added

- Repository baseline for the public AK Render package: MIT license,
  contribution guide, security policy, release policy, and CI covering lint,
  typecheck, unit tests, browser tests, build, and package smoke.
- TypeScript ESM package skeleton targeting Node >= 20.11, with a library entry
  point, an `ak-render` CLI bin, and a `pack`/install smoke test that exercises
  both surfaces from a throwaway consumer project.
- Architecture decision record
  ([ADR 0001](./docs/adr/0001-page-spec-compiler-boundary.md)) fixing the Page
  Spec versus internal IR split, catalog/registry separation, trusted
  interaction runtime, theme trust model, local/cloud boundary, and the
  optional AgentKit adapter model.
- Fixture corpus representing the plan, explain, recap, diff, dashboard, media,
  and interactive page classes.
- Reproducible baseline measurement of the legacy HTML presentation guidance
  currently carried in agent model context, with captured results under
  [docs/artifacts/](./docs/artifacts/).
