import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { auditUi, auditUiQuick, isHtmlInput } from '../../src/audit/ui-audit.js';
import { uiAuditPlan } from '../../src/audit/ui-audit-browser.js';
import { quickUiFindings } from '../../src/audit/ui-audit-quick.js';
import {
  buildUiReport,
  UI_FINDINGS_PER_RULE,
  type UiAuditReport,
  type UiFinding,
  uiAuditFails,
  uiFinding,
} from '../../src/audit/ui-audit-report.js';
import { UI_RULE_IDS, UI_RULES } from '../../src/audit/ui-audit-rules.js';
import { run } from '../../src/cli.js';
import { compile } from '../../src/index.js';
import { handleMcpMessage, type McpContext } from '../../src/mcp-server.js';

const page = (blocks: Record<string, unknown>[]) => ({
  version: 1,
  meta: { title: 'UI audit' },
  blocks,
});

const WIDE_TABLE = page([
  {
    type: 'table',
    title: 'Wide',
    columns: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    rows: [['1', '2', '3', '4', '5', '6', '7', '8']],
  },
]);

const CLEAN = page([{ type: 'text', text: 'hello' }]);

const LONG_LABELS = page([
  {
    type: 'chart',
    kind: 'bar',
    title: 'Throughput',
    labels: ['A rather long category name', 'Short'],
    series: [{ label: 'Runs', values: [3, 4] }],
  },
]);

const base: Omit<UiAuditReport, 'counts' | 'findings'> = {
  preset: 'quick',
  input: 'spec',
  complete: true,
  scripts: 'none',
  checks: [],
  budget: { timeoutMs: 0, network: 'blocked' },
  blockedRequests: 0,
};

describe('audit-ui rules', () => {
  it('registers every rule once with a fix', () => {
    expect(new Set(UI_RULE_IDS).size).toBe(UI_RULE_IDS.length);
    for (const id of UI_RULE_IDS) expect(UI_RULES[id]?.fix.length, id).toBeGreaterThan(20);
  });
});

describe('audit-ui quick preset', () => {
  it('flags a table wider than a phone screen at its spec path', () => {
    const report = auditUiQuick(WIDE_TABLE);
    expect(report.preset).toBe('quick');
    expect(report.scripts).toBe('none');
    expect(report.complete).toBe(true);
    const [finding] = report.findings;
    expect(finding).toMatchObject({
      rule: 'ui/wide-table',
      severity: 'warning',
      path: '$.blocks[0]',
      blockType: 'table',
      viewport: '375x812',
      evidence: 'columns=8 threshold=7',
    });
    expect(finding?.fix).toBe(UI_RULES['ui/wide-table']?.fix);
  });

  it('reports nothing for a plain page in the default theme', () => {
    expect(auditUiQuick(CLEAN).findings).toEqual([]);
  });

  it('reports long chart labels once per chart as info', () => {
    const findings = auditUiQuick(LONG_LABELS).findings.filter(
      (finding) => finding.rule === 'ui/long-chart-label',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', path: '$.blocks[0]' });
    expect(findings[0]?.message).toContain('"A rather long category name"');
  });

  it('flags a theme text colour below 4.5:1 on its surface', () => {
    const { theme } = compile(CLEAN, { source: 'clean' });
    const findings = quickUiFindings({
      html: '<p>x</p>',
      theme: { ...theme, light: { ...theme.light, 'color-text-muted': '#dddddd' } },
    });
    const muted = findings.filter((finding) => finding.evidence.includes('color-text-muted'));
    expect(muted.length).toBeGreaterThan(0);
    expect(muted[0]).toMatchObject({ rule: 'ui/theme-contrast', scheme: 'light', path: '$.theme' });
  });

  it('audits compiled HTML by markup location', () => {
    const { html } = compile(WIDE_TABLE, { source: 'wide' });
    const report = auditUiQuick(html);
    expect(report.input).toBe('html');
    expect(report.findings[0]).toMatchObject({ rule: 'ui/wide-table', path: 'html' });
    expect(report.findings[0]?.nodeId).toBeDefined();
  });

  it('scans unbalanced markup in linear time', () => {
    const hostile = `<!doctype html>${'<script><style><div class="ak-table-wrap"><thead><tr>'.repeat(20_000)}`;
    const started = performance.now();
    const report = auditUiQuick(hostile);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(report.findings).toEqual([]);
  });

  it('still reads tables after a closed script', () => {
    const { html } = compile(WIDE_TABLE, { source: 'wide' });
    const report = auditUiQuick(html.replace('<body', '<body><SCRIPT>let a = "<table>";</SCRIPT'));
    expect(report.findings.map((finding) => finding.rule)).toContain('ui/wide-table');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(auditUiQuick(WIDE_TABLE))).toBe(JSON.stringify(auditUiQuick(WIDE_TABLE)));
  });

  it('treats a leading byte-order mark and whitespace as HTML', () => {
    expect(isHtmlInput('﻿  <!doctype html>')).toBe(true);
    expect(isHtmlInput('version: 1')).toBe(false);
    expect(isHtmlInput({ version: 1 })).toBe(false);
  });
});

describe('audit-ui report', () => {
  const finding = (rule: string, path: string, evidence = 'x'): UiFinding =>
    uiFinding(rule, { message: 'm', path, evidence });

  it('sorts by severity, drops exact repeats and counts every finding', () => {
    const report = buildUiReport(base, [
      finding('ui/long-chart-label', '$.blocks[1]'),
      finding('ui/wide-table', '$.blocks[0]'),
      finding('ui/wide-table', '$.blocks[0]'),
      finding('ui/theme-contrast', '$.theme'),
    ]);
    expect(report.findings.map((item) => item.rule)).toEqual([
      'ui/theme-contrast',
      'ui/wide-table',
      'ui/long-chart-label',
    ]);
    expect(report.counts).toEqual({ error: 1, warning: 1, info: 1 });
  });

  it('caps each rule and counts the unlisted rest in one finding', () => {
    const many = Array.from({ length: UI_FINDINGS_PER_RULE + 5 }, (_, index) =>
      finding('ui/wide-table', `$.blocks[${String(index).padStart(2, '0')}]`),
    );
    const report = buildUiReport(base, many);
    expect(report.findings).toHaveLength(UI_FINDINGS_PER_RULE + 1);
    expect(report.counts.warning).toBe(UI_FINDINGS_PER_RULE + 5);
    expect(report.findings.filter((item) => item.evidence === '5 unlisted')).toHaveLength(1);
  });

  it('fails a gate at or above its severity, and always when incomplete', () => {
    const warned = buildUiReport(base, [finding('ui/wide-table', '$.blocks[0]')]);
    expect(uiAuditFails(warned, 'error')).toBe(false);
    expect(uiAuditFails(warned, 'warning')).toBe(true);
    expect(uiAuditFails(warned, 'info')).toBe(true);
    const incomplete = buildUiReport({ ...base, complete: false }, []);
    expect(uiAuditFails(incomplete, 'error')).toBe(true);
    expect(uiAuditFails(incomplete, 'none')).toBe(false);
  });
});

describe('audit-ui publication preset without a browser', () => {
  it('reports an unavailable browser as an incomplete audit', async () => {
    const report = await auditUi(WIDE_TABLE, {
      preset: 'publication',
      launch: () => Promise.reject(new Error('no chromium here\nstack')),
    });
    expect(report.complete).toBe(false);
    expect(report.scripts).toBe('compiled-runtime');
    expect(report.budget.network).toBe('blocked');
    const unavailable = report.findings.find((item) => item.rule === 'audit/browser-unavailable');
    expect(unavailable?.message).toBe('no browser could be launched: no chromium here');
    // Quick findings still come with it.
    expect(report.findings.some((item) => item.rule === 'ui/wide-table')).toBe(true);
    expect(uiAuditFails(report, 'error')).toBe(true);
  });

  it('runs compiled HTML from elsewhere with scripts off and says so', async () => {
    const { html } = compile(CLEAN, { source: 'clean' });
    const report = await auditUi(html, {
      preset: 'publication',
      launch: () => Promise.reject(new Error('none')),
    });
    expect(report.scripts).toBe('disabled');
    expect(report.findings.map((item) => item.rule)).toContain('audit/scripts-disabled');
  });

  it('plans light and dark at three widths, then no-JS, reduced motion and print', () => {
    const plan = uiAuditPlan(true);
    expect(plan.map((check) => `${check.viewport.width}/${check.scheme}/${check.mode}`)).toEqual([
      '375/light/screen',
      '768/light/screen',
      '1440/light/screen',
      '375/dark/screen',
      '768/dark/screen',
      '1440/dark/screen',
      '375/light/no-js',
      '375/light/reduced-motion',
      '794/light/print',
    ]);
    expect(plan.filter((check) => check.interactions)).toHaveLength(1);
    const untrusted = uiAuditPlan(false);
    expect(untrusted.some((check) => check.mode === 'no-js' || check.interactions)).toBe(false);
  });
});

describe('audit-ui CLI', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ak-render-ui-audit-'));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));
  const wide = join(workspace, 'wide.json');
  writeFileSync(wide, JSON.stringify(WIDE_TABLE));

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

  it('prints a JSON report and passes the default error gate on warnings', async () => {
    const c = io();
    expect(await run(['audit-ui', wide, '--json'], c.io)).toBe(0);
    const report = JSON.parse(c.out());
    expect(report).toMatchObject({ preset: 'quick', gate: { failOn: 'error', failed: false } });
    expect(report.findings[0].rule).toBe('ui/wide-table');
  });

  it('fails a warning gate', async () => {
    const c = io();
    expect(await run(['audit-ui', wide, '--fail-on', 'warning'], c.io)).toBe(1);
    expect(c.out()).toContain('gate failed: findings at warning or above');
    expect(c.out()).toContain('quick audit (structural, no browser)');
  });

  it('rejects an unknown preset and a bad timeout', async () => {
    const preset = io();
    expect(await run(['audit-ui', wide, '--preset', 'full'], preset.io)).toBe(2);
    expect(preset.err()).toContain('--preset must be one of quick, publication');
    const timeout = io();
    expect(await run(['audit-ui', wide, '--timeout', 'soon'], timeout.io)).toBe(2);
    expect(timeout.err()).toContain('--timeout must be a positive number');
  });
});

describe('audit-ui MCP tool', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ak-render-ui-mcp-'));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));
  const context: McpContext = { cwd: workspace, home: workspace };
  const call = async (args: Record<string, unknown>) =>
    (
      await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'audit-ui', arguments: args },
        },
        context,
      )
    )?.result as { content: { text: string }[]; isError?: boolean };

  it('runs the quick preset on a spec', async () => {
    const result = await call({ spec: WIDE_TABLE });
    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0]?.text ?? '');
    expect(report.preset).toBe('quick');
    expect(report.findings[0].rule).toBe('ui/wide-table');
  });

  it('rejects bad arguments', async () => {
    for (const [args, message] of [
      [{}, 'pass exactly one of "spec" or "html"'],
      [{ spec: CLEAN, preset: 'full' }, 'preset'],
      [{ html: 'not a page' }, 'must be an HTML document'],
      [{ spec: CLEAN, preset: 'publication', timeoutMs: 10 }, 'timeoutMs'],
    ] as const) {
      const result = await call(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
  });
});
