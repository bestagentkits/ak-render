import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { MAX_PATCH_OPERATIONS, patch, patchSpecText, specHash } from '../../src/index.js';
import { handleMcpMessage } from '../../src/mcp-server.js';
import { compile } from '../../src/render/render.js';
import { parseSpec } from '../../src/spec/parse.js';
import { MAX_PATCHED_SPEC_BYTES } from '../../src/spec/patch.js';

const SPEC = `# Quarterly report, edited by hand.
version: 1
meta:
  title: Quarterly report # keep this comment
blocks:
  - type: section
    id: overview
    title: Overview
    blocks:
      - type: text
        id: intro
        text: Revenue grew.
      - type: kpi
        id: revenue
        items:
          - label: Revenue
            value: "$1.2M"
  - type: tabs
    id: details
    items:
      - id: notes-tab
        title: Notes
        blocks:
          - type: text
            id: note
            text: Nested in a tab.
      - title: Sources
        text: Filed separately.
  - type: text
    text: No id here.
`;

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-patch-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function io() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    },
    out: () => stdout,
    err: () => stderr,
  };
}

function specFile(name: string, text = SPEC): string {
  const file = join(workspace, name);
  writeFileSync(file, text, 'utf8');
  return file;
}

describe('patch', () => {
  it('addresses blocks by id at any depth, including nested slots', () => {
    const result = patch(SPEC, [
      { op: 'replace', path: '/blocks/@revenue/items/0/value', value: '$1.4M' },
      { op: 'replace', path: '/blocks/@note/text', value: 'Edited in a tab.' },
      { op: 'test', path: '/blocks/@overview/title', value: 'Overview' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.changes).toEqual([
      { op: 'replace', path: '/blocks/0/blocks/1/items/0/value' },
      { op: 'replace', path: '/blocks/1/items/0/blocks/0/text' },
      { op: 'test', path: '/blocks/0/title' },
    ]);
    const spec = result.spec as { blocks: { blocks: { items: { value?: string }[] }[] }[] };
    expect(spec.blocks[0]?.blocks[1]?.items[0]?.value).toBe('$1.4M');
    expect(result.hash).toBe(specHash(result.spec));
    expect(result.baseHash).toBe(specHash(parseSpec(SPEC) as never));
    expect(result.hash).not.toBe(result.baseHash);
  });

  it('is the same spec an equivalent full edit compiles to', () => {
    const patched = patch(SPEC, [{ op: 'replace', path: '/blocks/@intro/text', value: 'Edited.' }]);
    const edited = SPEC.replace('Revenue grew.', 'Edited.');
    expect(compile(patched.spec).html).toBe(compile(edited).html);
    expect(patched.hash).toBe(specHash(parseSpec(edited) as never));
  });

  it('hashes content, not formatting or key order', () => {
    const json = JSON.stringify(parseSpec(SPEC));
    expect(patch(json, []).baseHash).toBe(patch(SPEC, []).baseHash);
    expect(specHash({ b: 1, a: 2 })).toBe(specHash({ a: 2, b: 1 }));
  });

  it('refuses a stale baseHash and changes nothing', () => {
    const result = patch(SPEC, [{ op: 'remove', path: '/blocks/@intro' }], {
      baseHash: 's-00000000000000',
    });
    expect(result.applied).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SPEC_PATCH_CONFLICT');
    expect(result.diagnostics[0]?.details?.currentHash).toBe(result.hash);
    expect(result.spec).toEqual(parseSpec(SPEC));
  });

  it('applies all operations or none', () => {
    const result = patch(SPEC, [
      { op: 'replace', path: '/blocks/@intro/text', value: 'changed' },
      { op: 'replace', path: '/blocks/@missing/text', value: 'x' },
    ]);
    expect(result.applied).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'SPEC_PATCH_ERROR', path: 'ops[1].path' }),
    ]);
    expect(result.diagnostics[0]?.details?.known).toEqual(
      expect.arrayContaining(['overview', 'intro', 'note']),
    );
    expect(JSON.stringify(result.spec)).toContain('Revenue grew.');
  });

  it('reports a failed test at its value', () => {
    const result = patch(SPEC, [{ op: 'test', path: '/blocks/@intro/text', value: 'nope' }]);
    expect(result.diagnostics[0]).toMatchObject({ code: 'SPEC_PATCH_ERROR', path: 'ops[0].value' });
  });

  it('refuses duplicate ids instead of guessing', () => {
    const doubled = SPEC.replace('id: note\n', 'id: intro\n');
    const result = patch(doubled, [{ op: 'remove', path: '/blocks/@intro' }]);
    expect(result.applied).toBe(false);
    expect(result.diagnostics[0]?.message).toMatch(/not unique/u);
  });

  it('moves a block by id and resolves the target after the removal', () => {
    const result = patch(SPEC, [
      { op: 'move', from: '/blocks/@revenue', path: '/blocks/@details/items/0/blocks/0' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.changes[0]).toEqual({
      op: 'move',
      from: '/blocks/0/blocks/1',
      path: '/blocks/1/items/0/blocks/0',
    });
  });

  it('supports add with "-", copy and plain RFC 6902 pointers', () => {
    const result = patch(SPEC, [
      { op: 'add', path: '/blocks/-', value: { type: 'text', text: 'Appended.' } },
      { op: 'copy', from: '/meta/title', path: '/meta/description' },
      { op: 'add', path: '/blocks/@overview/blocks/0', value: { type: 'text', text: 'First.' } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.changes.map((change) => change.path)).toEqual([
      '/blocks/3',
      '/meta/description',
      '/blocks/0/blocks/0',
    ]);
  });

  it('refuses a move into its own child', () => {
    for (const path of ['/blocks/0/blocks/0', '/blocks/@overview/blocks/-']) {
      const result = patch(SPEC, [{ op: 'move', from: '/blocks/@overview', path }]);
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0]?.message).toMatch(/into one of its own children/u);
    }
  });

  it('moves a block into a later sibling by id', () => {
    const result = patch(SPEC, [
      { op: 'move', from: '/blocks/@intro', path: '/blocks/@revenue/items/-' },
      { op: 'move', from: '/blocks/@overview', path: '/blocks/@details/items/0/blocks/-' },
    ]);
    expect(result.applied).toBe(true);
    expect(result.changes[1]).toEqual({
      op: 'move',
      from: '/blocks/0',
      path: '/blocks/0/items/0/blocks/1',
    });
  });

  it('refuses a patch that grows the spec without bound', () => {
    const ops: unknown[] = [{ op: 'add', path: '/state', value: { list: ['x'.repeat(1024)] } }];
    for (let index = 0; index < 40; index += 1) {
      ops.push({ op: 'copy', from: '/state/list', path: '/state/list/-' });
    }
    const result = patch(SPEC, ops);
    expect(result.applied).toBe(false);
    expect(result.diagnostics[0]?.message).toContain(String(MAX_PATCHED_SPEC_BYTES));
  });

  it('edits through a YAML alias without changing the other alias', () => {
    const text = `version: 1\nmeta: &m\n  title: T\nblocks:\n  - type: text\n    text: x\nstate: *m\n`;
    const result = patch(text, [{ op: 'replace', path: '/state/title', value: 'U' }]);
    expect(result.spec).toMatchObject({ meta: { title: 'T' }, state: { title: 'U' } });
  });

  it('rejects prototype keys, malformed operations and oversized patches', () => {
    expect(
      patch(SPEC, [{ op: 'add', path: '/meta/__proto__/polluted', value: true }]).applied,
    ).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(patch(SPEC, [{ op: 'rename', path: '/meta' }]).diagnostics[0]?.path).toBe('ops[0].op');
    expect(patch(SPEC, [{ op: 'replace', path: 'meta/title', value: 'x' }]).applied).toBe(false);
    expect(patch(SPEC, [{ op: 'replace', path: '/meta/title' }]).diagnostics[0]?.path).toBe(
      'ops[0].value',
    );
    expect(patch(SPEC, {}).diagnostics[0]?.path).toBe('ops');
    const many = Array.from({ length: MAX_PATCH_OPERATIONS + 1 }, () => ({
      op: 'test',
      path: '/version',
      value: 1,
    }));
    expect(patch(SPEC, many).applied).toBe(false);
  });

  it('reports validation diagnostics of the patched spec without hiding them', () => {
    const result = patch(SPEC, [{ op: 'replace', path: '/blocks/@intro/type', value: 'txet' }]);
    expect(result.applied).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.baseErrors).toBe(0);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.code).toBe('SPEC_UNKNOWN_BLOCK');
  });

  it('reports a spec parse error without throwing', () => {
    const result = patch('meta: [unclosed', []);
    expect(result.applied).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SPEC_PARSE_ERROR');
  });

  it('never mutates the caller object', () => {
    const input = parseSpec(SPEC) as Record<string, unknown>;
    const before = JSON.stringify(input);
    patch(input, [{ op: 'remove', path: '/blocks/@intro' }]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('patchSpecText', () => {
  it('keeps YAML comments and untouched layout', () => {
    const result = patchSpecText(SPEC, [
      { op: 'replace', path: '/blocks/@revenue/items/0/value', value: '$1.4M' },
      { op: 'move', from: '/blocks/@intro', path: '/blocks/@details/items/0/blocks/-' },
    ]);
    expect(result.preserved).toBe(true);
    expect(result.text).toContain('# Quarterly report, edited by hand.');
    expect(result.text).toContain('title: Quarterly report # keep this comment');
    expect(result.text).toContain('$1.4M');
    expect(parseSpec(result.text)).toEqual(result.spec);
  });

  it('keeps the comment on a replaced scalar', () => {
    const result = patchSpecText(SPEC, [{ op: 'replace', path: '/meta/title', value: 'Q4' }]);
    expect(result.preserved).toBe(true);
    expect(result.text).toContain('title: Q4 # keep this comment');
  });

  it('keeps CRLF line endings', () => {
    const crlf = SPEC.replace(/\n/gu, '\r\n');
    const yaml = patchSpecText(crlf, [{ op: 'replace', path: '/blocks/@intro/text', value: 'y' }]);
    expect(yaml.text).toBe(crlf.replace('text: Revenue grew.', 'text: y'));
    const json = `${JSON.stringify(parseSpec(SPEC), null, 2)}\n`.replace(/\n/gu, '\r\n');
    const edited = patchSpecText(json, [{ op: 'remove', path: '/blocks/@intro' }]);
    expect(
      edited.text
        .split('\n')
        .every((line, index, all) => index === all.length - 1 || line.endsWith('\r')),
    ).toBe(true);
  });

  it('keeps numeric-looking map keys as keys', () => {
    const text = `version: 1\nmeta:\n  title: T\nstate:\n  "2024": 1\nblocks:\n  - type: text\n    text: x\n`;
    const result = patchSpecText(text, [{ op: 'replace', path: '/state/2024', value: 2 }]);
    expect(result.preserved).toBe(true);
    expect(parseSpec(result.text)).toEqual(result.spec);
  });

  it('keeps JSON indentation', () => {
    const json = `${JSON.stringify(parseSpec(SPEC), null, 4)}\n`;
    const result = patchSpecText(json, [
      { op: 'replace', path: '/blocks/@intro/text', value: 'x' },
    ]);
    expect(result.format).toBe('json');
    expect(result.text).toMatch(/^\{\n {4}"version"/u);
    expect(result.text.endsWith('}\n')).toBe(true);
  });

  it('falls back to re-serializing when YAML aliases block an in-place edit', () => {
    const text = `version: 1\nmeta: &m\n  title: T\nblocks:\n  - type: text\n    text: x\nstate: *m\n`;
    const result = patchSpecText(text, [{ op: 'replace', path: '/state/title', value: 'U' }]);
    expect(parseSpec(result.text)).toEqual(result.spec);
  });
});

describe('ak-render patch', () => {
  it('edits the file in place from inline ops and prints the hash, not the spec', () => {
    const file = specFile('inline.yaml');
    const c = io();
    const ops = JSON.stringify([{ op: 'replace', path: '/blocks/@intro/text', value: 'Edited.' }]);
    expect(run(['patch', file, ops, '--json'], c.io)).toBe(0);
    const reply = JSON.parse(c.out());
    expect(reply).toMatchObject({ written: true, ok: true, preserved: true });
    expect(reply.spec).toBeUndefined();
    expect(reply.text).toBeUndefined();
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('text: Edited.');
    expect(written).toContain('# keep this comment');
    expect(reply.hash).toBe(specHash(parseSpec(written) as never));
    expect(readdirSync(workspace).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('chains edits through --base-hash and refuses a stale one', () => {
    const file = specFile('chain.yaml');
    const first = io();
    run(['patch', file, '[]', '--json'], first.io);
    const { hash } = JSON.parse(first.out());
    const second = io();
    const ops = '[{"op":"replace","path":"/blocks/@note/text","value":"Chained."}]';
    expect(run(['patch', file, ops, '--base-hash', hash, '--json'], second.io)).toBe(0);
    const stale = io();
    expect(run(['patch', file, ops, '--base-hash', hash], stale.io)).toBe(1);
    expect(stale.err()).toMatch(/changed since/u);
  });

  it('reads ops from a file and honours --dry-run', () => {
    const file = specFile('dry.yaml');
    const opsFile = join(workspace, 'ops.json');
    writeFileSync(opsFile, '[{"op":"replace","path":"/meta/title","value":"Dry"}]');
    const c = io();
    expect(run(['patch', file, opsFile, '--dry-run'], c.io)).toBe(0);
    expect(c.out()).toMatch(/not written \(dry run\)/u);
    expect(readFileSync(file, 'utf8')).toBe(SPEC);
  });

  it('does not write a patch that adds errors', () => {
    const file = specFile('broken.yaml');
    const c = io();
    const ops = '[{"op":"replace","path":"/blocks/@intro/type","value":"txet"}]';
    expect(run(['patch', file, ops], c.io)).toBe(1);
    expect(c.out()).toMatch(/adds errors/u);
    expect(c.err()).toMatch(/unknown block type/u);
    expect(readFileSync(file, 'utf8')).toBe(SPEC);
  });

  it('writes a patch that fixes part of an already broken spec', () => {
    const broken = SPEC.replace('type: text\n        id: intro', 'type: txet\n        id: intro');
    const file = specFile('partial.yaml', broken.replace('title: Notes', 'title: 5'));
    const c = io();
    const ops = '[{"op":"replace","path":"/blocks/0/blocks/0/type","value":"text"}]';
    run(['patch', file, ops, '--json'], c.io);
    expect(JSON.parse(c.out()).written).toBe(true);
  });

  it('keeps a symlinked spec a symlink', () => {
    const real = specFile('real.yaml');
    const link = join(workspace, 'link.yaml');
    symlinkSync(real, link);
    expect(
      run(['patch', link, '[{"op":"replace","path":"/meta/title","value":"L"}]'], io().io),
    ).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('title: L');
  });

  it('refuses stdin as the spec and non-spec file extensions', () => {
    expect(run(['patch', '-', '[]'], io().io)).toBe(2);
    const notes = join(workspace, 'notes.txt');
    writeFileSync(notes, SPEC);
    expect(run(['patch', notes, '[]'], io().io)).toBe(2);
    expect(run(['patch', specFile('one.yaml')], io().io)).toBe(2);
  });

  it('edits only a file that reads as a Page Spec', () => {
    const manifest = specFile('package.json', '{"name":"x","scripts":{"test":"vitest"}}\n');
    const c = io();
    expect(
      run(['patch', manifest, '[{"op":"replace","path":"/scripts/test","value":"y"}]'], c.io),
    ).toBe(2);
    expect(c.err()).toMatch(/not a Page Spec/u);
    expect(readFileSync(manifest, 'utf8')).toContain('vitest');
  });

  it('leaves no temporary file behind', () => {
    const dir = mkdtempSync(join(workspace, 'clean-'));
    const file = join(dir, 'page.yaml');
    writeFileSync(file, SPEC);
    run(['patch', file, '[{"op":"replace","path":"/meta/title","value":"Z"}]'], io().io);
    expect(readdirSync(dir)).toEqual(['page.yaml']);
  });
});

describe('patch over MCP', () => {
  const context = { cwd: workspace, home: workspace };
  function call(args: Record<string, unknown>) {
    const response = handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'patch', arguments: args } },
      context,
    );
    const result = response?.result as { content: { text: string }[]; isError?: boolean };
    const raw = result.content[0]?.text ?? '';
    return {
      isError: result.isError === true,
      raw,
      body: raw.startsWith('{') ? JSON.parse(raw) : {},
    };
  }

  it('returns patched YAML text for a text spec, comments included', () => {
    const { isError, body } = call({
      spec: SPEC,
      ops: [{ op: 'replace', path: '/blocks/@intro/text', value: 'Over MCP.' }],
    });
    expect(isError).toBe(false);
    expect(body.spec).toContain('# keep this comment');
    expect(body.spec).toContain('text: Over MCP.');
  });

  it('edits a file under the working directory and returns no spec', () => {
    specFile('mcp.yaml');
    const { isError, body } = call({
      file: 'mcp.yaml',
      ops: [{ op: 'replace', path: '/meta/title', value: 'Via file' }],
    });
    expect(isError).toBe(false);
    expect(body.written).toBe(true);
    expect(body.spec).toBeUndefined();
    expect(readFileSync(join(workspace, 'mcp.yaml'), 'utf8')).toContain('title: Via file');
  });

  it('reports a conflict as a tool error carrying the current hash', () => {
    const { isError, body } = call({ spec: SPEC, ops: [], baseHash: 's-stale' });
    expect(isError).toBe(true);
    expect(body.diagnostics[0].details.currentHash).toBe(body.hash);
  });

  it('edits only spec files inside the working directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ak-render-outside-'));
    try {
      writeFileSync(join(outside, 'page.yaml'), SPEC);
      symlinkSync(join(outside, 'page.yaml'), join(workspace, 'escape.yaml'));
      const ops = [{ op: 'replace', path: '/meta/title', value: 'x' }];
      expect(call({ file: join(outside, 'page.yaml'), ops }).raw).toMatch(/outside/u);
      expect(call({ file: 'escape.yaml', ops }).raw).toMatch(/outside/u);
      expect(call({ file: 'missing.yaml', ops }).raw).toMatch(/does not exist/u);
      specFile('settings.json', '{"hooks":{}}');
      expect(call({ file: 'settings.json', ops }).raw).toMatch(/not a Page Spec/u);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('asks for exactly one of spec and file', () => {
    expect(call({ ops: [] }).raw).toMatch(/pass "spec" or "file"/u);
    expect(call({ spec: SPEC, file: 'mcp.yaml', ops: [] }).raw).toMatch(/not both/u);
  });
});
