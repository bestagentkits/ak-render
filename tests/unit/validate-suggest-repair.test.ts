import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Diagnostic, repair, validate } from '../../src/index.js';
import { applyPatch, pathSegments } from '../../src/spec/json-patch.js';
import { parseSpec } from '../../src/spec/parse.js';

const ENVELOPE = 'version: 1\nmeta:\n  title: Repair\n';

function spec(blocks: string): string {
  return `${ENVELOPE}blocks:\n${blocks}`;
}

function at(diagnostics: readonly Diagnostic[], path: string): Diagnostic {
  const found = diagnostics.find((diagnostic) => diagnostic.path === path);
  if (found === undefined) throw new Error(`no diagnostic at ${path}`);
  return found;
}

describe('validate({ suggest: true })', () => {
  it('leaves diagnostics byte-identical without suggest', () => {
    const fixtures = join(import.meta.dirname, '../../fixtures/rejected');
    const files = readdirSync(fixtures, { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.(?:ya?ml|json)$/u.test(name),
    );
    expect(files.length).toBeGreaterThan(3);
    for (const name of files) {
      const text = readFileSync(join(fixtures, name), 'utf8');
      const plain = validate(text);
      expect(JSON.stringify(plain), name).not.toContain('"fixes"');
      const suggested = validate(text, { suggest: true });
      // Same codes, paths and order; suggest only adds `fixes`.
      expect(
        suggested.diagnostics.map(({ fixes: _fixes, ...rest }) => rest),
        name,
      ).toEqual(plain.diagnostics);
    }
  });

  it('suggests ranked, ambiguous replacements for an unknown block type', () => {
    const result = validate(spec('  - type: calout\n    title: Note\n    text: Body\n'), {
      suggest: true,
    });
    const diagnostic = at(result.diagnostics, '$.blocks[0].type');
    expect(diagnostic.code).toBe('SPEC_UNKNOWN_BLOCK');
    expect(diagnostic.fixes?.[0]).toEqual({
      rule: 'block/unknown-type',
      classification: 'ambiguous',
      path: '$.blocks[0].type',
      patch: [
        { op: 'test', path: '/blocks/0/type', value: 'calout' },
        { op: 'replace', path: '/blocks/0/type', value: 'callout' },
      ],
    });
    expect(diagnostic.fixes?.every((fix) => fix.classification === 'ambiguous')).toBe(true);
  });

  it('reports malformed YAML without inventing a patch', () => {
    const result = validate('version: 1\nmeta:\n  title: "A\n', { suggest: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('SPEC_PARSE_ERROR');
    expect(result.diagnostics[0]?.fixes).toBeUndefined();
  });

  it('anchors fixes to nested props and to bare block arrays', () => {
    const nested = validate(
      spec(
        '  - type: accordion\n    items:\n      - title: One\n        blocks:\n          - type: badge\n            text: Hi\n            tone: Warning\n',
      ),
      { suggest: true },
    );
    const tone = at(nested.diagnostics, '$.blocks[0].items[0].blocks[0].tone');
    expect(tone.fixes).toEqual([
      {
        rule: 'enum/case',
        classification: 'safe',
        path: '$.blocks[0].items[0].blocks[0].tone',
        patch: [
          { op: 'test', path: '/blocks/0/items/0/blocks/0/tone', value: 'Warning' },
          { op: 'replace', path: '/blocks/0/items/0/blocks/0/tone', value: 'warning' },
        ],
      },
    ]);

    const bare = validate([{ type: 'badge', text: 'Hi', tone: 'INFO' }], { suggest: true });
    expect(at(bare.diagnostics, '$.blocks[0].tone').fixes?.[0]?.patch[1]).toEqual({
      op: 'replace',
      path: '/0/tone',
      value: 'info',
    });
  });

  it('suggests renames for unknown properties, never deletions', () => {
    const result = validate(spec('  - type: callout\n    titel: Note\n    text: Body\n'), {
      suggest: true,
    });
    const unknown = at(result.diagnostics, '$.blocks[0].titel');
    expect(unknown.fixes).toEqual([
      {
        rule: 'property/rename',
        classification: 'ambiguous',
        path: '$.blocks[0].titel',
        patch: [
          { op: 'test', path: '/blocks/0/titel', value: 'Note' },
          { op: 'move', from: '/blocks/0/titel', path: '/blocks/0/title' },
        ],
      },
    ]);
    const ops = result.diagnostics.flatMap((d) => d.fixes ?? []).flatMap((f) => f.patch);
    expect(ops.some((op) => (op.op as string) === 'remove')).toBe(false);
  });

  it('does not rename onto a key the object already has', () => {
    const result = validate(
      spec('  - type: callout\n    title: Kept\n    titel: Note\n    text: Body\n'),
      { suggest: true },
    );
    expect(at(result.diagnostics, '$.blocks[0].titel').fixes).toBeUndefined();
  });

  it('suggests action types for an invalid action', () => {
    const result = validate(
      spec(
        '  - type: button\n    label: Copy\n    on:\n      click:\n        action: cpy\n        text: x\n',
      ),
      { suggest: true },
    );
    const action = at(result.diagnostics, '$.blocks[0].on.click.action');
    expect(action.fixes?.map((fix) => fix.patch[1])).toContainEqual({
      op: 'replace',
      path: '/blocks/0/on/click/action',
      value: 'copy',
    });
    expect(action.fixes?.every((fix) => fix.classification === 'ambiguous')).toBe(true);
  });
});

describe('repair({ mode: "safe" })', () => {
  it('wraps a single item and a single block, revalidates, and logs each change', () => {
    const input = spec(
      '  # a list written as one item\n  - type: list\n    items:\n      text: Only item\n  - type: grid\n    blocks:\n      type: card\n      title: Solo\n',
    );
    const result = repair(input, { mode: 'safe' });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.changes.map((change) => [change.rule, change.path])).toEqual([
      ['list/wrap-scalar', '$.blocks[0].items'],
      ['blocks/wrap-block', '$.blocks[1].blocks'],
    ]);
    expect(result.diagnostics).toEqual([]);
    // YAML keeps the author's comment, and the text is the repaired spec.
    expect(result.text).toContain('# a list written as one item');
    expect(validate(result.text).ok).toBe(true);
    expect(validate(result.text).diagnostics).toEqual([]);
  });

  it('fixes a case-only enum mismatch in nested props', () => {
    const result = repair(
      spec(
        '  - type: accordion\n    items:\n      - title: One\n        blocks:\n          - type: badge\n            text: Hi\n            tone: Warning\n',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.rule).toBe('enum/case');
  });

  it('leaves ambiguous repairs untouched and reports them with their fixes', () => {
    const input = spec(
      '  - type: calout\n    title: Note\n  - type: callout\n    titel: Note\n    text: Body\n  - type: badge\n    text: x\n    tone: warn\n',
    );
    const result = repair(input);
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.text).toBeUndefined();
    expect(result.spec).toEqual(parseSpec(input));
    for (const path of ['$.blocks[0].type', '$.blocks[1].titel', '$.blocks[2].tone']) {
      const diagnostic = at(result.diagnostics, path);
      expect(diagnostic.fixes?.length, path).toBeGreaterThan(0);
      expect(
        diagnostic.fixes?.every((fix) => fix.classification === 'ambiguous'),
        path,
      ).toBe(true);
    }
  });

  it('applies the safe fixes and keeps the ambiguous ones for the author', () => {
    const result = repair(
      spec('  - type: badge\n    text: x\n    tone: DANGER\n  - type: calout\n    title: Note\n'),
    );
    expect(result.changes.map((change) => change.rule)).toEqual(['enum/case']);
    expect(result.ok).toBe(false);
    expect(at(result.diagnostics, '$.blocks[1].type').code).toBe('SPEC_UNKNOWN_BLOCK');
  });

  it('refuses a fix that raises a new error elsewhere, and still applies the others', () => {
    const result = repair(
      spec(
        '  - type: grid\n    blocks:\n      type: card\n      id: dup\n      title: A\n  - type: card\n    id: dup\n    title: B\n  - type: badge\n    text: x\n    tone: Info\n',
      ),
    );
    // Wrapping the block would surface a duplicate id at $.blocks[1].id.
    expect(result.changes.map((change) => change.rule)).toEqual(['enum/case']);
    expect(result.ok).toBe(false);
    const left = at(result.diagnostics, '$.blocks[0].blocks');
    expect(left.fixes?.[0]?.rule).toBe('blocks/wrap-block');
  });

  it('returns malformed YAML unchanged with its parse diagnostic', () => {
    const result = repair('version: 1\nblocks: [\n');
    expect(result).toMatchObject({ ok: false, changed: false, changes: [] });
    expect(result.spec).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe('SPEC_PARSE_ERROR');
  });

  it('never wraps a value that would not be a valid item', () => {
    const result = repair(spec('  - type: list\n    items: 42\n'));
    expect(result.changed).toBe(false);
    expect(at(result.diagnostics, '$.blocks[0].items').fixes).toBeUndefined();
  });

  it('emits JSON for JSON input and leaves an already-valid spec alone', () => {
    const input = JSON.stringify({
      version: 1,
      meta: { title: 'J' },
      blocks: [{ type: 'list', items: { text: 'one' } }],
    });
    const result = repair(input);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text ?? '')).toEqual(result.spec);

    const clean = repair(result.text);
    expect(clean).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(clean.text).toBeUndefined();
  });

  it('rejects an unknown mode', () => {
    expect(() => repair('{}', { mode: 'aggressive' as 'safe' })).toThrowError(/mode/u);
  });
});

describe('patch helpers', () => {
  it('refuses a patch whose test precondition no longer holds', () => {
    const document = { blocks: [{ type: 'badge', tone: 'Warning' }] };
    const patch = [
      { op: 'test', path: '/blocks/0/tone', value: 'Info' },
      { op: 'replace', path: '/blocks/0/tone', value: 'info' },
    ] as const;
    expect(applyPatch(document, [...patch])).toBeUndefined();
    expect(document.blocks[0]?.tone).toBe('Warning');
  });

  it('refuses a move that would overwrite a member', () => {
    const document = { a: 1, b: 2 };
    expect(applyPatch(document, [{ op: 'move', from: '/a', path: '/b' }])).toBeUndefined();
  });

  it('only maps paths that name one location', () => {
    expect(pathSegments('$.blocks[2].items[0].url')).toEqual(['blocks', 2, 'items', 0, 'url']);
    expect(pathSegments('$.state.a.b')).toEqual(['state', 'a', 'b']);
    expect(pathSegments('blocks[0]')).toBeUndefined();
    expect(pathSegments('$.x[01]')).toBeUndefined();
  });
});
