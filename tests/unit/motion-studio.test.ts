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

describe('applyProposal keeps the author formatting', () => {
  const edit = (path: string, text: string, proposal: Parameters<typeof applyProposal>[1]) =>
    applyProposal(readSource(path, text), proposal);
  const changed = (before: string, after: string) =>
    lineDiff(before, after, 'x')
      .split('\n')
      .filter((line) => /^[-+][^-+]/u.test(line));

  it('keeps CRLF line endings and changes only the edited lines', () => {
    const crlf = YAML_SPEC.replace(/\n/gu, '\r\n');
    const after = edit('page.yaml', crlf, { blocks: { 'inner-card': 'reveal-soft' } });
    expect(
      after
        .split('\n')
        .slice(0, -1)
        .every((line) => line.endsWith('\r')),
    ).toBe(true);
    expect(changed(crlf, after)).toEqual(['+        motion: reveal-soft']);
  });

  it('keeps folded scalars and flow collections outside and inside the edit', () => {
    const text = `version: 1
meta:
  title: Flow
  description: >-
    a folded line
    that continues
blocks:
  - {type: card, id: flow-card, title: A, text: x}
  - type: card
    id: block-card
    title: B
    text: y
`;
    expect(
      changed(text, edit('page.yaml', text, { blocks: { 'block-card': 'reveal-soft' } })),
    ).toEqual(['+    motion: reveal-soft']);
    expect(
      changed(text, edit('page.yaml', text, { blocks: { 'flow-card': 'reveal-soft' } })),
    ).toEqual([
      '-  - {type: card, id: flow-card, title: A, text: x}',
      '+  - {type: card, id: flow-card, title: A, text: x, motion: reveal-soft}',
    ]);
  });

  it('keeps tab indentation, inline objects and escapes in JSON', () => {
    const text =
      '{\n\t"version": 1,\n\t"meta": { "title": "Caf\\u00e9" },\n\t"blocks": [\n\t\t{\n\t\t\t"type": "card",\n\t\t\t"id": "tab-card",\n\t\t\t"title": "B",\n\t\t\t"text": "y"\n\t\t}\n\t]\n}\n';
    const after = edit('page.json', text, { blocks: { 'tab-card': 'reveal-soft' } });
    expect(changed(text, after)).toEqual([
      '-\t\t\t"text": "y"',
      '+\t\t\t"text": "y",',
      '+\t\t\t"motion": "reveal-soft"',
    ]);
    expect(after).toContain('"meta": { "title": "Caf\\u00e9" }');
  });

  it('serializes the whole document when the edit cannot map onto the source', () => {
    const text =
      '{"version":1,"meta":{"title":"One line"},"blocks":[{"type":"card","id":"c","title":"C","text":"t"}]}';
    const after = edit('page.json', text, { blocks: { c: 'reveal-soft' } });
    expect(JSON.parse(after).blocks[0].motion).toBe('reveal-soft');
  });

  it('refuses a motion value that an alias elsewhere copies', () => {
    const text = `version: 1
meta: {title: Anchors}
blocks:
  - {type: card, id: a, title: A, text: x, motion: &m reveal-soft}
  - {type: card, id: b, title: B, text: y, motion: *m}
`;
    expectRenderError(
      () => edit('page.yaml', text, { blocks: { a: 'reveal-up' } }),
      /YAML anchor/u,
    );
    // Replacing the alias changes only its own block.
    const after = edit('page.yaml', text, { blocks: { b: 'reveal-up' } });
    expect(changed(text, after)).toEqual([
      '-  - {type: card, id: b, title: B, text: y, motion: *m}',
      '+  - {type: card, id: b, title: B, text: y, motion: reveal-up}',
    ]);
  });

  it('edits through an anchor that nothing refers to', () => {
    const text = `version: 1
meta: {title: Anchors}
theme: &th
  preset: editorial
blocks: &all
  - &one {type: card, id: c, title: A, text: x}
`;
    expect(changed(text, edit('page.yaml', text, { blocks: { c: 'reveal-soft' } }))).toHaveLength(
      2,
    );
    expect(
      changed(text, edit('page.yaml', text, { tokens: { 'motion-duration': '300ms' } })),
    ).toEqual(['+  tokens:', '+    motion-duration: 300ms']);
  });

  it('refuses a block whose list or parent is shared through a YAML anchor', () => {
    for (const blocks of [
      '  - type: section\n    title: S\n    blocks: &kids\n      - {type: card, title: A, text: y}\n  - type: section\n    title: T\n    blocks: *kids\n',
      '  - &s {type: section, title: S, blocks: [{type: card, title: A, text: y}]}\n  - *s\n',
    ]) {
      const text = `version: 1\nmeta: {title: Anchors}\nblocks:\n${blocks}`;
      const card = studioState(readSource('page.yaml', text), {}).blocks.find(
        (block) => block.path === '$.blocks[1].blocks[0]',
      );
      expect(card).toBeDefined();
      expectRenderError(
        () => edit('page.yaml', text, { blocks: { [card?.id ?? '']: 'reveal-soft' } }),
        /YAML anchor/u,
      );
    }
  });

  it('refuses a token value that an alias elsewhere copies', () => {
    const text = `version: 1
meta: {title: Anchors}
theme: {preset: editorial, tokens: {motion-duration: &d 200ms}}
blocks:
  - {type: card, id: c, title: A, text: *d}
`;
    expectRenderError(
      () => edit('page.yaml', text, { tokens: { 'motion-duration': '300ms' } }),
      /YAML anchor/u,
    );
  });

  it('keeps the line endings of a CRLF file without a final newline', () => {
    const crlf = YAML_SPEC.trimEnd().replace(/\n/gu, '\r\n');
    const added = edit(
      'page.yaml',
      crlf
        .replace('    motion: reveal-soft', '    text: z')
        .replace('    text: Top-level card.\r\n', ''),
      {
        blocks: { 'plain-card': 'reveal-soft' },
      },
    );
    expect(added.endsWith('\r\n    motion: reveal-soft')).toBe(true);
    expect(
      added
        .split('\n')
        .slice(0, -1)
        .every((line) => line.endsWith('\r')),
    ).toBe(true);
    const replaced = edit('page.yaml', crlf, { blocks: { 'plain-card': 'reveal-up' } });
    expect(replaced).toBe(crlf.replace('motion: reveal-soft', 'motion: reveal-up'));
  });

  it('keeps a file without a final newline that way', () => {
    const text = `${YAML_SPEC.trimEnd()}\n  - type: card\n    id: last-card\n    title:   Last\n    text: y`;
    const after = edit('page.yaml', text, { blocks: { 'last-card': 'reveal-soft' } });
    expect(after.endsWith('    motion: reveal-soft')).toBe(true);
    expect(changed(text, after)).toEqual(['+    motion: reveal-soft']);
  });

  it('keeps each line ending of a file that mixes LF and CRLF', () => {
    const mixed = YAML_SPEC.replace('\n', '\r\n');
    const after = edit('page.yaml', mixed, { blocks: { 'inner-card': 'reveal-soft' } });
    expect(after.replace('        motion: reveal-soft\n', '')).toBe(mixed);
  });

  it('refuses a stream of several YAML documents or one with YAML errors', () => {
    expectRenderError(
      () =>
        edit('page.yaml', `${YAML_SPEC}---\n${YAML_SPEC}`, {
          tokens: { 'motion-duration': '300ms' },
        }),
      /single YAML document/u,
    );
    expectRenderError(
      () =>
        edit('page.yaml', YAML_SPEC.replace('version: 1\n', 'version: 1\nversion: 1\n'), {
          tokens: { 'motion-duration': '300ms' },
        }),
      /YAML error/u,
    );
  });

  it('refuses a version 0 spec, whose theme the migration replaces', () => {
    const text = 'blocks:\n  - {type: card, id: old-card, title: A, text: x}\n';
    expectRenderError(
      () => edit('page.yaml', text, { tokens: { 'motion-duration': '300ms' } }),
      /version 1 specs/u,
    );
  });
});

describe('startMotionStudio file handling', () => {
  const post = (url: string, session: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ak-studio': session },
      body: JSON.stringify(body),
    });

  it('writes through a symlink to its target and keeps the target mode', async () => {
    const { chmodSync, lstatSync, statSync, symlinkSync } = await import('node:fs');
    const directory = mkdtempSync(join(workspace, 'link-'));
    const target = join(directory, 'spec.yaml');
    const link = join(directory, 'link.yaml');
    writeFileSync(target, YAML_SPEC);
    chmodSync(target, 0o640);
    symlinkSync(target, link);
    const studio = await startMotionStudio({ file: link });
    try {
      const session = /\/studio\/([0-9a-f]{32})\/$/u.exec(studio.url)?.[1] as string;
      const view = await (await post(`${studio.url}api/state`, session, {})).json();
      const accepted = await post(`${studio.url}api/accept`, session, {
        proposal: { tokens: { 'motion-easing': 'linear' } },
        hash: view.state.source.hash,
      });
      expect(accepted.status).toBe(200);
    } finally {
      await studio.close();
    }
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('motion-easing: linear');
    // Windows keeps no POSIX permission bits to preserve.
    if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  it('fails to start on an unreadable path or a version 0 spec', async () => {
    const directory = mkdtempSync(join(workspace, 'bad-'));
    await expect(startMotionStudio({ file: directory })).rejects.toThrow(/EISDIR/u);
    const old = join(directory, 'old.yaml');
    writeFileSync(old, 'blocks:\n  - {type: card, id: a, title: A, text: x}\n');
    await expect(startMotionStudio({ file: old })).rejects.toThrow(/version 1 specs/u);
  });

  it('refuses a wrong content type, a large body and a cross-origin preflight', async () => {
    const file = join(mkdtempSync(join(workspace, 'limits-')), 'page.yaml');
    writeFileSync(file, YAML_SPEC);
    const studio = await startMotionStudio({ file });
    try {
      const session = /\/studio\/([0-9a-f]{32})\/$/u.exec(studio.url)?.[1] as string;
      const plain = await fetch(`${studio.url}api/state`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'x-ak-studio': session },
        body: '{}',
      });
      expect(plain.status).toBe(415);
      const large = await fetch(`${studio.url}api/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ak-studio': session },
        body: JSON.stringify({ proposal: {}, pad: 'x'.repeat(1_100_000) }),
      });
      expect(large.status).toBe(413);
      const preflight = await fetch(`${studio.url}api/accept`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
      });
      expect(preflight.status).toBe(405);
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await studio.close();
    }
  });
});
