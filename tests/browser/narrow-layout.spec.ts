import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const workspace = browserWorkspace('narrow-layout');

const WIDTHS = [1440, 768, 375] as const;

/** Compile a spec and open the artifact from disk at the given width. */
async function open(page: Page, name: string, source: string, width: number): Promise<void> {
  const target = workspace.write(name, compile(source).html);
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

const WIDE_TABLE = `version: 1
meta: { title: Wide table }
blocks:
  - type: section
    title: Changes
    blocks:
      - type: table
        title: Changed files
        columns: [Path, Status, Owner, Additions, Deletions, Reviewer, Notes, Milestone]
        rows:
          - [ "src/render/very-long-module-name.ts", modified, platform-team, "10", "1", someone, "a fairly long note about this change", "2026-q4" ]
`;

test.describe('a wide table scrolls inside its frame', () => {
  test('at 375px the page stays put and the frame shows it has more', async ({ page }) => {
    await open(page, 'wide-table', WIDE_TABLE, 375);
    expect(await pageOverflow(page)).toBe(0);
    const frame = page.locator('.ak-table-wrap');
    const scrolls = await frame.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(scrolls).toBe(true);
    // The trailing edge is shaded while there is more to the right.
    const sizes = await frame.evaluate((element) =>
      getComputedStyle(element)
        .backgroundSize.split(',')
        .slice(0, 2)
        .map((size) => size.trim()),
    );
    expect(sizes).toEqual(['0px 100%', '14px 100%']);
  });

  test('at 1440px a table that fits shows no edge shade', async ({ page }) => {
    const narrow = WIDE_TABLE.replace(/columns: .*\n/u, 'columns: [Path, Status]\n').replace(
      /- \[ .* \]\n/u,
      '- [ "src/a.ts", modified ]\n',
    );
    await open(page, 'fitting-table', narrow, 1440);
    const shaded = await page
      .locator('.ak-table-wrap')
      .evaluate((element) => getComputedStyle(element).backgroundSize.includes('14px'));
    expect(shaded).toBe(false);
  });
});

const LONG_SESSION = `version: 1
meta: { title: Long session }
blocks:
  - type: terminal
    title: Session
    lines:
${Array.from(
  { length: 30 },
  (_, index) =>
    `      - { kind: ${index % 3 === 0 ? 'command' : 'output'}, text: "line ${index + 1}" }`,
).join('\n')}
`;

test.describe('a long terminal session', () => {
  test('draws every line within a moment of arriving', async ({ page }) => {
    await open(page, 'long-session', LONG_SESSION, 1440);
    await expect(page.locator('.ak-terminal[data-ak-inview]')).toHaveCount(1);
    // Each line's entrance ends by delay + duration; the slowest bounds how long
    // a capture can catch the session half drawn.
    const settlesBy = await page.locator('.ak-term-line').evaluateAll((lines) =>
      Math.max(
        ...lines.map((line) => {
          const style = getComputedStyle(line);
          return (
            Number.parseFloat(style.animationDelay) + Number.parseFloat(style.animationDuration)
          );
        }),
      ),
    );
    expect(settlesBy).toBeGreaterThan(0);
    expect(settlesBy).toBeLessThanOrEqual(1.5);
    // Lines past the last stagger step keep the order: none starts before line 12.
    const delays = await page
      .locator('.ak-term-line')
      .evaluateAll((lines) => lines.map((line) => getComputedStyle(line).animationDelay));
    expect(delays.slice(11).every((delay) => delay === delays[11])).toBe(true);
  });

  test('grows to show its last line', async ({ page }) => {
    await open(page, 'long-session-height', LONG_SESSION, 375);
    const body = page.locator('.ak-terminal-body');
    const clipped = await body.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(clipped).toBe(false);
    await expect(page.locator('.ak-term-line').last()).toHaveText('line 30');
  });
});
