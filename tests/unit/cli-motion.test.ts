import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { motionCatalog, searchMotions } from '../../src/motion/motion-catalog.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-motion-cli-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const GALLERY_PAGE = fileURLToPath(
  new URL('../../docs/gallery/motion-recipes.html', import.meta.url),
);
const FIXTURE = fileURLToPath(new URL('../../fixtures/pages/motion-recipes.yaml', import.meta.url));

/** Two blocks: a clean card and a nested arrival that warns. */
const WARNING_SPEC = `version: 1
meta:
  title: Nested motion
blocks:
  - type: section
    id: outer
    title: Outer
    motion: reveal-soft
    blocks:
      - type: card
        id: inner
        title: Inner
        text: Body.
        motion: reveal-soft
`;

const CLEAN_SPEC = `version: 1
meta:
  title: Clean motion
blocks:
  - type: card
    id: solo
    title: Solo
    text: Body.
    motion: reveal-soft
`;

const ERROR_SPEC = `version: 1
meta:
  title: Unknown motion
blocks:
  - type: card
    id: ghost
    title: Ghost
    text: Body.
    motion: spin-forever
`;

function write(name: string, text: string): string {
  const path = join(workspace, name);
  writeFileSync(path, text, 'utf8');
  return path;
}

function capture(stdin?: string) {
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
      ...(stdin === undefined ? {} : { stdin: () => stdin }),
    },
    out: () => stdout,
    err: () => stderr,
  };
}

describe('ak-render motions', () => {
  it('lists every recipe, one per block, with its purpose', () => {
    const c = capture();
    expect(run(['motions'], c.io)).toBe(0);
    for (const entry of motionCatalog().recipes) {
      expect(c.out()).toContain(entry.id);
      expect(c.out()).toContain(entry.purpose);
    }
    expect(c.out()).toContain('blocks: ');
    expect(c.out()).toContain('motion: <id> on a block');
  });

  it('prints the catalog as JSON with the same fields the library returns', () => {
    const c = capture();
    expect(run(['motions', '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out())).toEqual(motionCatalog());
  });

  it('searches recipes by intent, as text and as JSON', () => {
    const json = capture();
    expect(run(['motions', 'search', 'tabs', '--json'], json.io)).toBe(0);
    const hits = JSON.parse(json.out()) as { id: string; purpose: string; score: number }[];
    expect(hits[0]?.id).toBe('tabs-slide');
    expect(hits).toEqual(searchMotions('tabs'));

    const text = capture();
    expect(run(['motions', 'search', 'smooth', 'tabs'], text.io)).toBe(0);
    expect(text.out().split('\n')[0]).toContain('tabs-slide — ');
  });

  it('says so when a search matches nothing, and exits 0', () => {
    const c = capture();
    expect(run(['motions', 'search', 'zzqxv'], c.io)).toBe(0);
    expect(c.out()).toBe('no motion recipes match "zzqxv"\n');
  });

  it('describes one recipe in compact JSON with no version field', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-slide', '--compact', '--json'], c.io)).toBe(0);
    const described = JSON.parse(c.out()) as Record<string, unknown>;
    expect(described['id']).toBe('tabs-slide');
    expect(described).not.toHaveProperty('version');
    expect(described).toHaveProperty('example');
  });

  it('describes one recipe in full JSON with the registry fields', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-slide', '--json'], c.io)).toBe(0);
    const described = JSON.parse(c.out()) as Record<string, unknown>;
    expect(described['version']).toBe(1);
    expect(described['durationMs']).toBeTypeOf('number');
  });

  it('describes several recipes as a JSON array', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-slide', 'stagger', '--compact', '--json'], c.io)).toBe(
      0,
    );
    expect((JSON.parse(c.out()) as { id: string }[]).map((entry) => entry.id)).toEqual([
      'tabs-slide',
      'stagger',
    ]);
  });

  it('describes a recipe as text with one field per line and the example last', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-slide'], c.io)).toBe(0);
    const lines = c.out().trimEnd().split('\n');
    expect(lines[0]).toContain('tabs-slide — ');
    expect(lines.some((line) => line.startsWith('  triggers: '))).toBe(true);
    expect(lines.at(-1)?.startsWith('  example: {')).toBe(true);
  });

  it('exits 1 with suggestions for an unknown recipe id', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-sloe'], c.io)).toBe(1);
    expect(c.err()).toContain('unknown motion recipe "tabs-sloe"');
    expect(c.err()).toContain('did you mean: tabs-slide');
  });

  it('exits 1 when any id in a describe list is unknown', () => {
    const c = capture();
    expect(run(['motions', 'describe', 'tabs-slide', 'nope-recipe', '--json'], c.io)).toBe(1);
    expect(c.out()).toBe('');
  });

  it('exits 2 for a missing search term, a missing id, or an unknown action', () => {
    for (const argv of [
      ['motions', 'search'],
      ['motions', 'describe'],
      ['motions', 'bogus'],
    ]) {
      const c = capture();
      expect(run(argv, c.io), argv.join(' ')).toBe(2);
      expect(c.err()).toContain('ak-render:');
    }
  });

  it('documents the motions and motion commands in help', () => {
    const c = capture();
    run(['--help'], c.io);
    expect(c.out()).toContain('ak-render motions');
    expect(c.out()).toContain('ak-render motion audit');
  });
});

describe('ak-render motion audit', () => {
  it('audits a clean spec with exit 0 and a JSON report on stdout', () => {
    const c = capture();
    expect(run(['motion', 'audit', write('clean.yaml', CLEAN_SPEC), '--json'], c.io)).toBe(0);
    const report = JSON.parse(c.out()) as {
      mode: string;
      reliability: string;
      counts: Record<string, number>;
      gate: { failOn: string; failed: boolean };
      source: string;
    };
    expect(report.mode).toBe('spec');
    expect(report.reliability).toBe('authoritative');
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(report.gate).toEqual({ failOn: 'error', failed: false });
    expect(report.source).toMatch(/clean\.yaml$/u);
  });

  it('prints a text summary with the score and advisory label', () => {
    const c = capture();
    expect(run(['motion', 'audit', write('clean-text.yaml', CLEAN_SPEC)], c.io)).toBe(0);
    expect(c.out()).toContain('spec audit (authoritative), 0 error(s), 0 warning(s), 0 info');
    expect(c.out()).toContain('score 100/100 (advisory)');
    expect(c.out()).not.toContain('gate failed');
  });

  it('exits 0 for a warning under the default error gate', () => {
    const c = capture();
    expect(run(['motion', 'audit', write('warn-default.yaml', WARNING_SPEC), '--json'], c.io)).toBe(
      0,
    );
    const report = JSON.parse(c.out()) as { counts: { warning: number } };
    expect(report.counts.warning).toBe(1);
  });

  it('exits 1 for a warning when the gate is warning, and says the gate failed', () => {
    const json = capture();
    expect(
      run(
        ['motion', 'audit', write('warn.yaml', WARNING_SPEC), '--fail-on', 'warning', '--json'],
        json.io,
      ),
    ).toBe(1);
    expect((JSON.parse(json.out()) as { gate: unknown }).gate).toEqual({
      failOn: 'warning',
      failed: true,
    });

    const text = capture();
    expect(
      run(
        ['motion', 'audit', write('warn-text.yaml', WARNING_SPEC), '--fail-on', 'warning'],
        text.io,
      ),
    ).toBe(1);
    expect(text.out()).toContain('warning motion/nested-arrival');
    expect(text.out()).toContain('gate failed: findings at warning or above');
  });

  it('exits 1 for an error under the default gate', () => {
    const c = capture();
    expect(run(['motion', 'audit', write('error.yaml', ERROR_SPEC)], c.io)).toBe(1);
    expect(c.out()).toContain('error motion/unknown-recipe');
  });

  it('exits 0 for an error when the gate is none', () => {
    const c = capture();
    expect(
      run(['motion', 'audit', write('error-none.yaml', ERROR_SPEC), '--fail-on', 'none'], c.io),
    ).toBe(0);
  });

  it('exits 2 for an unknown --fail-on value', () => {
    const c = capture();
    expect(
      run(['motion', 'audit', write('clean-bogus.yaml', CLEAN_SPEC), '--fail-on', 'bogus'], c.io),
    ).toBe(2);
    expect(c.err()).toContain('--fail-on must be one of error, warning, info, none');
  });

  it('exits 2 for a missing subcommand, a missing file, or an unreadable file', () => {
    for (const argv of [
      ['motion'],
      ['motion', 'check', write('x.yaml', CLEAN_SPEC)],
      ['motion', 'audit'],
      ['motion', 'audit', join(workspace, 'does-not-exist.yaml')],
      ['motion', 'audit', write('extra.yaml', CLEAN_SPEC), 'extra'],
    ]) {
      const c = capture();
      expect(run(argv, c.io), argv.join(' ')).toBe(2);
    }
  });

  it('refuses to start the studio on stdin, HTML, a missing file or a bad port', () => {
    for (const [argv, message] of [
      [['motion', 'studio', '-'], 'not stdin or HTML'],
      [['motion', 'studio', GALLERY_PAGE], 'not stdin or HTML'],
      [['motion', 'studio', join(workspace, 'missing.yaml')], 'no such file'],
      [['motion', 'studio', FIXTURE, '--port', 'abc'], '--port must be an integer'],
      [['motion', 'studio', FIXTURE, '--port', '70000'], '--port must be an integer'],
      [['motion', 'studio', FIXTURE, '--port', '1e3'], '--port must be an integer'],
    ] as const) {
      const c = capture();
      expect(run([...argv], c.io), argv.join(' ')).toBe(2);
      expect(c.err()).toContain(message);
    }
  });

  it('audits the motion recipes fixture without findings', () => {
    const c = capture();
    expect(run(['motion', 'audit', FIXTURE, '--json'], c.io)).toBe(0);
    expect((JSON.parse(c.out()) as { findings: unknown[] }).findings).toEqual([]);
  });

  it('detects an HTML file by its extension and audits it as a compiled page', () => {
    const c = capture();
    expect(run(['motion', 'audit', GALLERY_PAGE, '--json'], c.io)).toBe(0);
    const report = JSON.parse(c.out()) as {
      mode: string;
      reliability: string;
      trusted: boolean;
      counts: { error: number; warning: number };
    };
    expect(report.mode).toBe('html');
    expect(report.reliability).toBe('best-effort');
    expect(report.trusted).toBe(true);
    expect(report.counts.error).toBe(0);
    expect(report.counts.warning).toBe(0);
  });

  it('detects an HTML page piped on stdin by its doctype', () => {
    const html = readFileSync(GALLERY_PAGE, 'utf8');
    const c = capture(html);
    expect(run(['motion', 'audit', '-', '--json'], c.io)).toBe(0);
    expect((JSON.parse(c.out()) as { mode: string }).mode).toBe('html');
  });

  it('detects a piped page that opens with a BOM, a comment or a bare tag', () => {
    const html = readFileSync(GALLERY_PAGE, 'utf8');
    const fragment = '<style>.a{animation:spin 1s}</style><div>page</div>';
    for (const text of [`\uFEFF${html}`, `<!-- saved page -->\n${html}`, fragment]) {
      const c = capture(text);
      expect(run(['motion', 'audit', '-', '--json', '--fail-on', 'none'], c.io)).toBe(0);
      expect((JSON.parse(c.out()) as { mode: string }).mode).toBe('html');
    }
  });

  it('gates an HTML file by its findings the same way as a spec', () => {
    const untrusted = join(workspace, 'untrusted.html');
    copyFileSync(GALLERY_PAGE, untrusted);
    const text = readFileSync(untrusted, 'utf8').replace(/<meta name="generator"[^>]*>/u, '');
    writeFileSync(
      untrusted,
      text.replace('</head>', '<style>.zz{animation:ak-m-fade 1s}</style></head>'),
      'utf8',
    );
    const c = capture();
    expect(run(['motion', 'audit', untrusted, '--fail-on', 'error'], c.io)).toBe(1);
    expect(c.out()).toContain('error html/unguarded-motion');
  });
});

describe('ak-render motion audit baseline', () => {
  /** Writes the JSON report of a spec as the baseline a later run compares against. */
  function baselineOf(specPath: string, name: string): string {
    const c = capture();
    run(['motion', 'audit', specPath, '--fail-on', 'none', '--json'], c.io);
    return write(name, c.out());
  }

  it('forgives a standing warning that the baseline already holds, so it exits 0 at warning level', () => {
    const spec = write('standing-warning.yaml', WARNING_SPEC);
    const baseline = baselineOf(spec, 'warning-baseline.json');
    const c = capture();
    expect(
      run(['motion', 'audit', spec, '--fail-on', 'warning', '--baseline', baseline], c.io),
    ).toBe(0);
    expect(c.out()).toContain('baseline: 0 new, 0 resolved');
    expect(c.out()).not.toContain('gate failed');
  });

  it('still fails at error level on a standing error that the baseline holds', () => {
    const spec = write('standing-error.yaml', ERROR_SPEC);
    const baseline = baselineOf(spec, 'error-baseline.json');
    const c = capture();
    expect(
      run(['motion', 'audit', spec, '--fail-on', 'error', '--baseline', baseline, '--json'], c.io),
    ).toBe(1);
    const report = JSON.parse(c.out()) as {
      baseline: { added: unknown[]; resolved: unknown[] };
      gate: { failed: boolean };
    };
    expect(report.baseline).toEqual({ added: [], resolved: [] });
    expect(report.gate.failed).toBe(true);
  });

  it('fails on a warning added since the baseline and reports it as new', () => {
    const clean = write('before-clean.yaml', CLEAN_SPEC);
    const baseline = baselineOf(clean, 'clean-baseline.json');
    const c = capture();
    expect(
      run(
        [
          'motion',
          'audit',
          write('after-warning.yaml', WARNING_SPEC),
          '--fail-on',
          'warning',
          '--baseline',
          baseline,
        ],
        c.io,
      ),
    ).toBe(1);
    expect(c.out()).toContain('baseline: 1 new, 0 resolved');
  });

  it('reports a finding the baseline held and the current spec lost as resolved', () => {
    const baseline = baselineOf(
      write('resolve-before.yaml', WARNING_SPEC),
      'resolve-baseline.json',
    );
    const c = capture();
    expect(
      run(
        ['motion', 'audit', write('resolve-after.yaml', CLEAN_SPEC), '--baseline', baseline],
        c.io,
      ),
    ).toBe(0);
    expect(c.out()).toContain('baseline: 0 new, 1 resolved');
  });

  it('exits 2 for a baseline that is not JSON, or that has no findings list', () => {
    const spec = write('baseline-target.yaml', CLEAN_SPEC);
    const notJson = write('not-json.json', '{nope');
    const c1 = capture();
    expect(run(['motion', 'audit', spec, '--baseline', notJson], c1.io)).toBe(2);
    expect(c1.err()).toContain('cannot read baseline');

    const noFindings = write('no-findings.json', '{"counts":{}}');
    const c2 = capture();
    expect(run(['motion', 'audit', spec, '--baseline', noFindings], c2.io)).toBe(2);
    expect(c2.err()).toContain('it has no findings list');
  });

  it('exits 2 for a baseline path that does not exist', () => {
    const c = capture();
    expect(
      run(
        [
          'motion',
          'audit',
          write('missing-baseline.yaml', CLEAN_SPEC),
          '--baseline',
          join(workspace, 'absent.json'),
        ],
        c.io,
      ),
    ).toBe(2);
  });
});
