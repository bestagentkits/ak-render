import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';

function page(blocks: string): string {
  return `version: 1
meta:
  title: Narrow layout fixture
blocks:
${blocks}`;
}

/** The page stylesheet, which is the first style element in the head. */
const css = (html: string): string => html.slice(html.indexOf('<style'), html.indexOf('</style>'));

describe('long unbroken tokens', () => {
  const { html } = compile(
    page(`  - type: key-value
    items:
      - { key: home, value: "HOME/AGENTKIT_HOME/CODEX_HOME/TMPDIR" }`),
  );

  it('lets any text break a token that cannot fit its line', () => {
    expect(css(html)).toMatch(/body\{[^}]*overflow-wrap:break-word/u);
  });

  it('lets a key-value value shrink below its longest token', () => {
    expect(css(html)).toContain('.ak-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}');
    // The stacked phone layout keeps a track that can shrink to the column.
    expect(css(html)).toContain('.ak-kv{grid-template-columns:minmax(0,1fr)}');
  });
});

describe('sideways scrollers', () => {
  it('shades the edges of a table frame from its own scroll position', () => {
    const { html } = compile(
      page(`  - type: table
    columns: [A, B]
    rows:
      - [ "1", "2" ]`),
    );
    expect(css(html)).toContain(
      '@supports (animation-timeline:scroll()){.ak-table-wrap{background:radial-gradient(',
    );
    expect(css(html)).toContain('animation-timeline:scroll(self inline)');
    expect(css(html)).toContain('@keyframes ak-scroll-edges{');
  });

  it('keeps an adapter diagram at its natural size and fits it to the page in print', () => {
    const { html } = compile(
      page(`  - type: diagram-panel
    title: Flow
    spec:
      components: [ { id: a, label: A } ]`),
    );
    expect(css(html)).toContain(
      '.ak-diagram-rendered svg{display:block;max-width:none;height:auto}',
    );
    expect(css(html)).toContain(
      '@media print{.ak-diagram-rendered{overflow:visible;box-shadow:none}.ak-diagram-rendered svg{max-width:100%}',
    );
  });
});

describe('terminal entrance', () => {
  const { html } = compile(
    page(`  - type: terminal
    lines:
      - { kind: command, text: ls }`),
  );
  const delays = [
    ...css(html).matchAll(/\.ak-term-line:nth-child\(([^)]+)\)\{animation-delay:([\d.]+)s\}/gu),
  ];

  it('settles the whole session quickly, so a capture does not catch blank lines', () => {
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.max(...delays.map((match) => Number(match[2])))).toBeLessThanOrEqual(0.9);
  });

  it('gives every line past the last step that step delay, so lines keep their order', () => {
    expect(delays.at(-1)?.[1]).toBe('n + 12');
  });
});
