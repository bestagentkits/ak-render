import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { RenderError } from '../../src/errors.js';
import {
  applyProposal,
  checkProposal,
  inspectBlock,
  jsonPathKeys,
  lineDiff,
  readSource,
  recipeCss,
  studioState,
} from '../../src/motion/studio/studio-model.js';
import { type MotionStudio, startMotionStudio } from '../../src/motion/studio/studio-server.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-motion-studio-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../fixtures/pages/motion-recipes.yaml', import.meta.url)),
  'utf8',
);

const YAML_SPEC = `version: 1
# The page title is reviewed by marketing.
meta:
  title: Studio test
theme:
  preset: editorial
blocks:
  - type: section
    id: outer
    title: Outer
    blocks:
      - type: card
        id: inner-card # keep this id stable
        title: Inner
        text: Nested card.
  - type: card
    id: plain-card
    title: Plain
    text: Top-level card.
    motion: reveal-soft
`;

const JSON_SPEC = `${JSON.stringify(
  {
    version: 1,
    meta: { title: 'JSON studio' },
    blocks: [{ type: 'card', id: 'json-card', title: 'Card', text: 'Text.' }],
  },
  null,
  4,
)}\n`;

function expectRenderError(action: () => unknown, pattern: RegExp): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RenderError);
  expect((caught as RenderError).message).toMatch(pattern);
}

describe('jsonPathKeys', () => {
  it('splits an IR path into keys and indexes', () => {
    expect(jsonPathKeys('$.blocks[2].items[0].blocks[1]')).toEqual([
      'blocks',
      2,
      'items',
      0,
      'blocks',
      1,
    ]);
    expect(jsonPathKeys('$')).toEqual([]);
  });

  it('rejects paths it cannot follow exactly', () => {
    expectRenderError(() => jsonPathKeys('blocks[0]'), /unsupported path/u);
    expectRenderError(() => jsonPathKeys('$.blocks[0]["x"]'), /unsupported path/u);
  });
});

describe('checkProposal', () => {
  it('accepts the closed proposal shape', () => {
    const proposal = {
      blocks: { 'inner-card': 'reveal-soft', 'plain-card': null },
      tokens: { 'motion-duration': '240ms', 'motion-easing': 'linear', 'motion-policy': null },
    };
    expect(checkProposal(proposal)).toEqual(proposal);
    expect(checkProposal({})).toEqual({});
  });

  it.each([
    [null, /must be an object/u],
    [{ extra: true }, /extra/u],
    [{ blocks: { a: 'no-such-recipe' } }, /no-such-recipe/u],
    [{ tokens: { 'motion-duration': '2s' } }, /motion-duration/u],
    [{ tokens: { 'motion-duration': '1010ms' } }, /motion-duration/u],
    [{ tokens: { 'motion-duration': '-5ms' } }, /motion-duration/u],
    [{ tokens: { 'motion-easing': 'cubic-bezier(0,0,1,1)' } }, /motion-easing/u],
    [{ tokens: { 'motion-policy': 'loud' } }, /motion-policy/u],
    [{ tokens: { 'font-body': 'serif' } }, /font-body/u],
  ])('rejects %j', (proposal, pattern) => {
    expectRenderError(() => checkProposal(proposal), pattern);
  });
});

describe('applyProposal', () => {
  it('edits YAML in place and keeps comments and order', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    const next = applyProposal(source, {
      blocks: { 'inner-card': 'reveal-soft', 'plain-card': null },
      tokens: { 'motion-duration': '240ms' },
    });
    expect(next).toContain('# The page title is reviewed by marketing.');
    expect(next).toContain('id: inner-card # keep this id stable');
    expect(next).toMatch(
      /id: inner-card # keep this id stable\n {8}title: Inner\n {8}text: Nested card\.\n {8}motion: reveal-soft/u,
    );
    expect(next).not.toMatch(/plain-card[\s\S]*motion:/u);
    expect(next).toContain('  tokens:\n    motion-duration: 240ms');
    expect(next.indexOf('meta:')).toBeLessThan(next.indexOf('theme:'));
  });

  it('round trips: removing what it added restores the original text', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    const added = applyProposal(source, {
      blocks: { 'inner-card': 'reveal-soft' },
      tokens: { 'motion-easing': 'linear' },
    });
    const restored = applyProposal(readSource('page.yaml', added), {
      blocks: { 'inner-card': null },
      tokens: { 'motion-easing': null },
    });
    expect(restored).toBe(YAML_SPEC);
  });

  it('drops an emptied theme it created', () => {
    const bare = YAML_SPEC.replace('theme:\n  preset: editorial\n', '');
    const source = readSource('page.yaml', bare);
    const added = applyProposal(source, { tokens: { 'motion-policy': 'reduced' } });
    expect(added).toContain('theme:\n  tokens:\n    motion-policy: reduced');
    const removed = applyProposal(readSource('page.yaml', added), {
      tokens: { 'motion-policy': null },
    });
    expect(removed).toBe(bare);
  });

  it('edits JSON and keeps its indent and trailing newline', () => {
    const source = readSource('page.json', JSON_SPEC);
    expect(source.format).toBe('json');
    const next = applyProposal(source, { blocks: { 'json-card': 'reveal-soft' } });
    expect(next.endsWith('}\n')).toBe(true);
    expect(next).toContain('\n    "blocks": [');
    expect(JSON.parse(next).blocks[0].motion).toBe('reveal-soft');
  });

  it('returns the text untouched for an empty proposal', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    expect(applyProposal(source, {})).toBe(YAML_SPEC);
  });

  it('names the known ids when a block id is unknown', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    expectRenderError(
      () => applyProposal(source, { blocks: { missing: 'reveal-soft' } }),
      /no block has the id "missing"/u,
    );
  });
});

describe('studioState', () => {
  it('lists blocks with their compatible recipes and a diff of the proposal', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    const state = studioState(source, { tokens: { 'motion-duration': '300ms' } });
    expect(state.ok).toBe(true);
    expect(state.tokens['motion-duration']).toBe('300ms');
    const card = state.blocks.find((block) => block.id === 'inner-card');
    expect(card).toMatchObject({ type: 'card', motion: null, path: '$.blocks[0].blocks[0]' });
    expect(card?.compatible).toContain('reveal-soft');
    expect(state.diff).toContain('+  tokens:');
    expect(state.diff).toContain('+    motion-duration: 300ms');
    expect(state.audit?.mode).toBe('spec');
    expect(state.html).toMatch(/^<!doctype html>/iu);
  });

  it('reports a recipe the block cannot take as a compile error, without throwing', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    const state = studioState(source, { blocks: { 'plain-card': 'tabs-slide' } });
    expect(state.ok).toBe(false);
    expect(state.error?.message).toMatch(/tabs-slide/u);
    expect(state.diff).toContain('+    motion: tabs-slide');
    expect(state.html).toBeUndefined();
  });

  it('inspects timing at the theme duration and the emitted CSS', () => {
    const source = readSource('page.yaml', YAML_SPEC);
    const state = studioState(source, { tokens: { 'motion-duration': '200ms' } });
    const inspection = inspectBlock(state, state.html as string, 'plain-card');
    expect(inspection.recipe?.id).toBe('reveal-soft');
    expect(inspection.timing?.baseMs).toBe(200);
    expect(inspection.timing?.durationMs).toBeGreaterThan(0);
    expect(inspection.css).toContain('[data-ak-motion="reveal-soft"]');
    expect(inspectBlock(state, state.html as string, 'inner-card').css).toBe('');
  });

  it('handles the full motion fixture', () => {
    const state = studioState(readSource('motion-recipes.yaml', FIXTURE), {});
    expect(state.ok).toBe(true);
    expect(state.diff).toBe('');
    expect(state.blocks.filter((block) => block.motion !== null).length).toBeGreaterThanOrEqual(7);
  });
});

describe('recipeCss', () => {
  it('keeps media wrappers and only the named keyframes', () => {
    const html = `<style>
      .x{color:red}
      [data-ak-motion="a"]{opacity:0}
      @media (prefers-reduced-motion: no-preference){[data-ak-motion="a"].in{animation:ak-a 1s}.y{top:0}}
      @keyframes ak-a{from{opacity:0}to{opacity:1}}
      @keyframes ak-b{from{opacity:0}to{opacity:1}}
      [data-ak-motion="b"]{opacity:1}
    </style>`;
    const css = recipeCss(html, 'a', ['ak-a']);
    expect(css).toBe(
      [
        '[data-ak-motion="a"]{opacity:0}',
        '@media (prefers-reduced-motion: no-preference){[data-ak-motion="a"].in{animation:ak-a 1s}}',
        '@keyframes ak-a{from{opacity:0}to{opacity:1}}',
      ].join('\n'),
    );
  });
});

describe('lineDiff', () => {
  it('is empty for equal texts', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n', 'x')).toBe('');
  });

  it('writes a unified hunk with three lines of context', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const after = ['1', '2', '3', '4', 'five', '6', '7', '8', '9'].join('\n');
    expect(lineDiff(before, after, 'page.yaml')).toBe(
      [
        '--- a/page.yaml',
        '+++ b/page.yaml',
        '@@ -2,7 +2,7 @@',
        ' 2',
        ' 3',
        ' 4',
        '-5',
        '+five',
        ' 6',
        ' 7',
        ' 8',
        '',
      ].join('\n'),
    );
  });
});

describe('startMotionStudio', () => {
  async function withStudio(
    text: string,
    test: (studio: MotionStudio, file: string, session: string) => Promise<void>,
  ): Promise<void> {
    const file = join(mkdtempSync(join(workspace, 'run-')), 'page.yaml');
    writeFileSync(file, text);
    const studio = await startMotionStudio({ file });
    try {
      const session = /\/studio\/([0-9a-f]{32})\/$/u.exec(studio.url)?.[1] as string;
      await test(studio, file, session);
    } finally {
      await studio.close();
    }
  }

  const post = (url: string, session: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ak-studio': session },
      body: JSON.stringify(body),
    });

  it('listens on loopback behind a session path with a strict CSP', async () => {
    await withStudio(YAML_SPEC, async (studio) => {
      expect(studio.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/studio\/[0-9a-f]{32}\/$/u);
      const page = await fetch(studio.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(await page.text()).not.toMatch(/<script>|style="/u);
      expect((await fetch(new URL('/', studio.url))).status).toBe(404);
      const catalog = await (await fetch(`${studio.url}api/catalog`)).json();
      expect(catalog.recipes.length).toBeGreaterThanOrEqual(7);
      const gallery = await fetch(`${studio.url}gallery/reveal-soft`);
      expect(gallery.status).toBe(200);
      expect(await gallery.text()).toContain('data-ak-motion="reveal-soft"');
    });
  });

  it('previews under a motion policy without changing the diff, and rejects unknown modes', async () => {
    await withStudio(YAML_SPEC, async (studio, _file, session) => {
      const view = await (
        await post(`${studio.url}api/state`, session, { proposal: {}, preview: 'os-reduce' })
      ).json();
      expect(view.state.diff).toBe('');
      for (const url of [view.preview, view.original]) {
        const html = await (await fetch(new URL(url, studio.url))).text();
        expect(html).toMatch(/<html[^>]*data-motion="none"/u);
      }
      const bad = await post(`${studio.url}api/state`, session, { proposal: {}, preview: 'loud' });
      expect(bad.status).toBe(400);
    });
  });

  it('refuses posts without the session header', async () => {
    await withStudio(YAML_SPEC, async (studio) => {
      const response = await fetch(`${studio.url}api/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(403);
    });
  });

  it('serves previews and accepts a proposal with the current hash', async () => {
    await withStudio(YAML_SPEC, async (studio, file, session) => {
      const view = await (
        await post(`${studio.url}api/state`, session, {
          proposal: { blocks: { 'inner-card': 'reveal-soft' } },
        })
      ).json();
      expect(view.state.ok).toBe(true);
      expect(view.inspections['inner-card'].recipe.id).toBe('reveal-soft');
      const preview = await fetch(new URL(view.preview, studio.url));
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain('data-ak-motion="reveal-soft"');

      const accepted = await post(`${studio.url}api/accept`, session, {
        proposal: { blocks: { 'inner-card': 'reveal-soft' } },
        hash: view.state.source.hash,
      });
      expect(accepted.status).toBe(200);
      const result = await accepted.json();
      expect(result.diff).toContain('+        motion: reveal-soft');
      expect(readFileSync(file, 'utf8')).toContain('motion: reveal-soft');
      expect(readFileSync(file, 'utf8')).toContain('# keep this id stable');

      // The old hash is now stale.
      const stale = await post(`${studio.url}api/accept`, session, {
        proposal: { tokens: { 'motion-easing': 'linear' } },
        hash: view.state.source.hash,
      });
      expect(stale.status).toBe(409);
      expect((await stale.json()).stale).toBe(true);
    });
  });

  it('refuses an accept that would not compile or changes nothing', async () => {
    await withStudio(YAML_SPEC, async (studio, file, session) => {
      const view = await (await post(`${studio.url}api/state`, session, {})).json();
      const hash = view.state.source.hash;
      const invalid = await post(`${studio.url}api/accept`, session, {
        proposal: { blocks: { 'plain-card': 'tabs-slide' } },
        hash,
      });
      expect(invalid.status).toBe(422);
      const empty = await post(`${studio.url}api/accept`, session, { proposal: {}, hash });
      expect(empty.status).toBe(409);
      expect(readFileSync(file, 'utf8')).toBe(YAML_SPEC);
    });
  });

  it('rejects a foreign Host header', async () => {
    await withStudio(YAML_SPEC, async (studio) => {
      const { request } = await import('node:http');
      const url = new URL(studio.url);
      const status = await new Promise<number>((resolve, reject) => {
        const call = request(
          { host: '127.0.0.1', port: url.port, path: url.pathname, headers: { host: 'evil.test' } },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        call.on('error', reject);
        call.end();
      });
      expect(status).toBe(421);
    });
  });
});
