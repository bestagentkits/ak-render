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
