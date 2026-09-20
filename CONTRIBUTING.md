# Contributing

Thanks for helping improve AK Render. This repository owns the declarative Page
Spec schema and the compiler that turns it into deterministic, offline,
interactive HTML.

## Ground rules

- **Determinism is a contract.** Identical normalized spec plus compiler
  version and options must produce byte-identical output. No timestamps, no
  random IDs, no unordered map iteration in emitted output. If your change
  cannot be made deterministic, it does not belong in the compiler.
- **Page Spec input is untrusted.** Never interpolate spec values into HTML,
  CSS, or JavaScript without the compiler's escaping and allowlisting helpers.
- **Presentation lives in the compiler.** Do not add prompts, CSS templates, or
  "copy this snippet" guidance to AgentKit skills for anything the compiler can
  own.
- **Tests land with the behavior.** A behavior change without its fixture is an
  incomplete change. Prefer contract tests and golden fixtures over
  implementation assertions.

## Development setup

Node.js >= 20.11 and pnpm 9.15 are required.

```bash
pnpm install
pnpm verify          # lint + typecheck + unit tests + build
pnpm test:browser    # needs: pnpm exec playwright install chromium
pnpm test:package    # packs, installs into a temp project, exercises the API and bin
```

`pnpm verify` is the expected pre-push gate. Browser and package jobs run in CI
on Ubuntu.

## Commits and pull requests

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Keep a commit focused: one behavior, one commit, with its tests.
- Do not include AI authorship attribution or internal plan identifiers in
  commit messages, code comments, or fixtures.
- Describe the evidence layer for your change: schema change, compiler
  behavior, emitted artifact, or documentation. Do not present a schema
  decision as shipped behavior, or a local run as a released result.
- Add or update a fixture for every acceptance criterion you touch.

## Adding a block, widget, or action

New registry entries must ship with their machine-readable contract in the same
change: purpose, compact prompt-facing description, props schema with defaults
and bounds, slot and child constraints, responsive sizing behavior,
accessibility contract, supported actions, asset and runtime features required,
network capability, migration policy, and serializer behavior.

Prefer a semantic block over a primitive. A primitive is an escape hatch, not a
convenience wrapper.

## Adding a theme

Themes are typed data, never CSS. Extend an existing preset with `extends` and
set tokens. Rejecting unknown or executable values is part of the contract; a
theme cannot introduce a new styling mechanism.

## Reporting issues

Open an issue with a minimal Page Spec, the compiler version, the exact command
you ran, and the observed versus expected output. For security reports, follow
[SECURITY.md](./SECURITY.md) instead.
