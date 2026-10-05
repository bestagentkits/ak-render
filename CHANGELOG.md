# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release mechanics and the compatibility contract live in
[docs/release-policy.md](./docs/release-policy.md).

## [Unreleased]

### Changed

- Polished the emitted artifacts:
  - Heading sizes now follow the `font-scale` token.
  - Spacing is driven by density, with larger gaps at section breaks.
  - The hero carries an accent eyebrow rule, and the theme toggle is a right-aligned pill.
  - Callouts, badges and tables are tinted, buttons and tabs have hover and press states, and all transitions use the motion tokens.
  - Mobile touch targets are 44px.
- Charts now have clean axis ticks with gridlines, rounded bars centered under their labels, a series palette derived from the theme accent, legends, a donut total, and SVG heights sized to their content (sparkline and progress).
- Elevation shadows are layered. A table title no longer prints twice; its caption is kept for screen readers only.
- Artifacts now emit `og:title`, `og:type`, `og:description` and `twitter:card` from the spec meta.
- The gallery index is now one card per artifact.

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
