import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-narrow-layout-'));

test.afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const WIDTHS = [1440, 768, 375] as const;

/** Compile a spec and open the artifact from disk at the given width. */
async function open(page: Page, name: string, source: string, width: number): Promise<void> {
  mkdirSync(workspace, { recursive: true });
  const target = join(workspace, `${name}.html`);
  writeFileSync(target, compile(source).html, 'utf8');
  await page.setViewportSize({ width, height: 812 });
  await page.goto(`file://${target}`, { waitUntil: 'load' });
}

function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const LONG_PATH =
  '/Users/someone/.claude/worktrees/agent-a52dad79d0c4f1e61/node_modules/.pnpm/@playwright+test@1.56.0/node_modules';

const LONG_TOKENS = `version: 1
meta: { title: Long tokens }
blocks:
  - type: key-value
    items:
      - { key: isolated go test, value: "Each go test run gets a throwaway HOME/AGENTKIT_HOME/CODEX_HOME/TMPDIR under one run-owned scratch root removed on exit." }
      - { key: path, value: "${LONG_PATH}" }
  - type: list
    items:
      - { text: "AGENTKIT_HOME=${LONG_PATH}", badge: new }
  - type: text
    text: "Set ${LONG_PATH} before running."
  - type: callout
    tone: info
    title: "${LONG_PATH}"
    text: "AGENTKIT_HOME=${LONG_PATH}"
`;

test.describe('long unbroken tokens wrap instead of widening the page', () => {
  for (const width of WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await open(page, `long-tokens-${width}`, LONG_TOKENS, width);
      expect(await pageOverflow(page)).toBe(0);
    });
  }
});
