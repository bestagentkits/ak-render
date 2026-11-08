# Claude plugin

`plugins/ak-render/` is the folder submitted to the Claude plugin directory and
the folder the repository's Claude marketplace (`.claude-plugin/marketplace.json`)
installs. People who install the plugin receive only that folder, so it holds
everything the plugin loads and nothing else:

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest; starts the local MCP server with `npx -y @bestagentkits/render@<version> mcp` |
| `.claude-plugin/icon.png` | Listing icon (512 px square, copied from `assets/logo.png`) |
| `skills/ak-render/SKILL.md` | The skill, written for the pinned package version |
| `skills/ak-render/examples/*.yaml` | Report, dashboard and architecture review specs with fictional sample data |
| `assets/*.webp` | README screenshots of the three examples |
| `README.md`, `LICENSE` | Listing text, surface matrix, privacy and support; the repository license |

The repository-level `skills/ak-render/SKILL.md` stays the skill for
`npx skills add` and the Codex plugin (`plugin.json`, `mcp.json`,
`.agents/plugins/`). It follows the source tree, while the Claude plugin skill
follows the published version the plugin pins.

## Rules for the folder

`tests/unit/plugin-manifests.test.ts` enforces these:

- The manifest version and every `@bestagentkits/render@…` reference in the
  skill and README equal `src/version.ts`.
- Only regular files: no symlinks, OS junk files, package-manager configs or
  lockfiles; only Markdown, JSON, YAML, PNG, WebP and `LICENSE`; non-image
  files under 256 KiB; at most 512 files.
- `LICENSE` is byte-identical to the repository license.
- README images exist, and the three bundled examples validate with no
  diagnostics.
- No `.claude-plugin/plugin.json` at the repository root, so the directory
  never treats the whole repository as the plugin.

The skill text must only use commands and MCP tools that the pinned version
ships. When a release adds commands, update the plugin skill in the same
change as the version bump.

## Supported surfaces

| Surface | Status |
| --- | --- |
| Claude Code | Supported and verified: the skill loads and the local MCP server starts. |
| Cowork on the user's computer | Expected from the [platform support](https://claude.com/docs/plugins/platform-support) rules (skills and local MCP servers load); not yet verified by the maintainers. |
| Cowork not on the user's computer | Not supported: local MCP servers don't start. |
| claude.ai chat | Not supported: chat ignores local MCP servers, and the skill needs local Node.js. |

The plugin does not reference the hosted endpoint at
`https://render.agentkit.best/mcp`. That endpoint needs an AgentKit account and
is a separate MCP connector submission, not part of this bundle.

## Verify before a release or submission

```bash
pnpm test -- tests/unit/plugin-manifests.test.ts
pnpm test:plugin
```

`pnpm test:plugin` (`scripts/claude-plugin-smoke.mjs`) runs the pinned package
from the npm registry, so run it only after that version is published. It
renders each example twice and requires identical bytes and no remote
resource, checks that an invalid spec exits 1 without writing a file and a
missing spec exits 2, drives the MCP server over stdio and compares its
render with the CLI bytes, and runs
`claude plugin validate plugins/ak-render --profile directory --strict` when the
`claude` CLI is on `PATH`.

For an end-to-end check, run a real prompt with the folder loaded:

```bash
claude --plugin-dir plugins/ak-render -p "Use the AK Render plugin to make an offline HTML report page saved as report.html ..." \
  --allowedTools "mcp__plugin_ak-render_ak-render" "Skill" "Write(./**)" "Read(./**)"
```

## Directory review expectations

From the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist):

- **Runs a pinned npx package** is always held for a reviewer, because the
  package's own dependencies resolve at install time. This is expected; the
  README discloses what runs and what is downloaded.
- The repository root `.gitattributes` sets `text=auto eol=lf`. It sets no
  `filter`, `export-ignore` or `export-subst`, but if the portal reports
  **Couldn't validate that repository**, check this file first.

## Submission

Submission happens in the developer portal at
<https://claude.ai/directory/manage> (**Submit new → Plugin bundle**, repository
`bestagentkits/ak-render`, plugin path `plugins/ak-render`, tracked branch
`main`). It needs a claude.ai account on a paid plan, and the first
organization to submit a repository folder owns the listing, so submit from the
long-term owner organization. Run **Validate**, fix every **Blocking** finding,
then submit. Record the submission status and, after publishing, the usage
figures on the tracking issue; never describe the plugin as approved or
published before the portal says so.
