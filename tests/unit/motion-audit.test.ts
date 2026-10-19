import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  auditMotionHtml,
  auditMotionSpec,
  compareMotionAudits,
  MOTION_ARRIVAL_BUDGET,
  MOTION_FINDINGS_PER_RULE,
  MOTION_SCORE_WEIGHTS,
  type MotionAuditReport,
  type MotionFinding,
  type MotionSeverity,
  motionAuditFails,
  motionFindingKey,
} from '../../src/motion/motion-audit.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const GALLERY = fileURLToPath(new URL('../../docs/gallery', import.meta.url));
const MOTION_GALLERY_PAGE = `${GALLERY}/motion-recipes.html`;

const readText = (path: string) => readFileSync(path, 'utf8');

const spec = (block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  meta: { title: 'Audit' },
  ...extra,
  blocks: [block],
});

const card = (id: string, motion?: unknown) => ({
  type: 'card',
  id,
  title: `Card ${id}`,
  text: 'Body text.',
  ...(motion === undefined ? {} : { motion }),
});

const ruleIds = (report: MotionAuditReport) => report.findings.map((finding) => finding.rule);

const findingFor = (report: MotionAuditReport, rule: string) =>
  report.findings.find((finding) => finding.rule === rule);

/** A trusted, minimal compiled page; the CSP and generator are what the rules read. */
function htmlPage({
  css = '',
  script = '',
  body = '',
  head = '',
  csp = "default-src 'none'; style-src 'nonce-a'; script-src 'nonce-b'",
  generator = true,
  attributes = '',
}: {
  css?: string;
  script?: string;
  body?: string;
  head?: string;
  csp?: string | null;
  generator?: boolean;
  attributes?: string;
}): string {
  const meta = generator ? '<meta name="generator" content="@bestagentkits/render 0.3.0">' : '';
  const policy = csp === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  return `<!doctype html><html lang="en"${attributes}><head><meta charset="utf-8">${meta}${policy}<style>${css}</style>${head}</head><body>${body}<script>${script}</script></body></html>`;
}

const GUARD = '@media (prefers-reduced-motion:no-preference)';

describe('spec audit: motion validation rules', () => {
  it('flags a recipe name no registry entry carries', () => {
    const report = auditMotionSpec(spec(card('a', 'spin-forever')));
    expect(findingFor(report, 'motion/unknown-recipe')).toMatchObject({
      severity: 'error',
      path: '$.blocks[0].motion',
    });
  });

  it('accepts a known recipe on a block it suits', () => {
    expect(ruleIds(auditMotionSpec(spec(card('a', 'reveal-soft'))))).not.toContain(
      'motion/unknown-recipe',
    );
  });

  it('flags a recipe on a block type it does not target and suggests the valid ones', () => {
    const report = auditMotionSpec(
      spec({
        type: 'tabs',
        id: 'wrong',
        items: [
          { title: 'One', text: 'First.' },
          { title: 'Two', text: 'Second.' },
        ],
        motion: 'reveal-soft',
      }),
    );
    const finding = findingFor(report, 'motion/incompatible-recipe');
    expect(finding).toMatchObject({ severity: 'error', path: '$.blocks[0].motion' });
    expect(finding?.fix).toContain('tabs-slide');
  });

  it('accepts a targeted recipe on the block it names', () => {
    const report = auditMotionSpec(
      spec({
        type: 'tabs',
        id: 'right',
        items: [
          { title: 'One', text: 'First.' },
          { title: 'Two', text: 'Second.' },
        ],
        motion: 'tabs-slide',
      }),
    );
    expect(ruleIds(report)).not.toContain('motion/incompatible-recipe');
    expect(report.findings).toEqual([]);
  });

  it('flags a recipe that needs visibleWhen on a block that has none', () => {
    const report = auditMotionSpec(
      spec({ type: 'callout', id: 'note', title: 'Note', text: 'Body.', motion: 'fade-swap' }),
    );
    expect(findingFor(report, 'motion/needs-visible-when')).toMatchObject({
      severity: 'error',
      path: '$.blocks[0].motion',
    });
  });

  it('accepts the same recipe once the block declares visibleWhen', () => {
    const report = auditMotionSpec(
      spec(
        {
          type: 'callout',
          id: 'note',
          title: 'Note',
          text: 'Body.',
          visibleWhen: { path: 'state.plan', equals: 'annual' },
          motion: 'fade-swap',
        },
        { state: { plan: 'monthly' } },
      ),
    );
    expect(ruleIds(report)).not.toContain('motion/needs-visible-when');
  });

  it('flags raw motion fields such as a duration or CSS beside the recipe', () => {
    const report = auditMotionSpec(spec(card('a', { preset: 'reveal-soft', duration: '1s' })));
    expect(findingFor(report, 'motion/raw-motion-field')).toMatchObject({
      severity: 'error',
      path: '$.blocks[0].motion.duration',
    });
  });

  it('accepts the object form that names only a preset', () => {
    const report = auditMotionSpec(spec(card('a', { preset: 'reveal-soft' })));
    expect(ruleIds(report)).not.toContain('motion/raw-motion-field');
    expect(report.findings).toEqual([]);
  });

  it('flags a motion value that is neither a recipe name nor a preset object', () => {
    const report = auditMotionSpec(spec(card('a', 42)));
    expect(findingFor(report, 'motion/invalid-value')).toMatchObject({
      severity: 'error',
      path: '$.blocks[0].motion',
    });
  });

  it('flags a validation error outside motion as spec/invalid and skips the motion rules', () => {
    const report = auditMotionSpec(
      spec({ type: 'card', id: 'typo', titel: 'Oops', text: 'x', motion: 'reveal-soft' }),
    );
    expect(findingFor(report, 'spec/invalid')).toMatchObject({ severity: 'error' });
    expect(report.counts.error).toBeGreaterThan(0);
    expect(findingFor(report, 'motion/arrival-overuse')).toBeUndefined();
  });

  it('keeps a valid spec free of spec/invalid', () => {
    expect(ruleIds(auditMotionSpec(spec(card('ok', 'reveal-soft'))))).not.toContain('spec/invalid');
  });
});

describe('spec audit: motion placement and timing rules', () => {
  it('flags an arrival recipe nested inside another arrival recipe', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Nested' },
      blocks: [
        {
          type: 'section',
          id: 'outer',
          title: 'Outer',
          motion: 'reveal-soft',
          blocks: [card('inner', 'reveal-soft')],
        },
      ],
    });
    expect(findingFor(report, 'motion/nested-arrival')).toMatchObject({
      severity: 'warning',
      nodeId: 'inner',
      path: '$.blocks[0].blocks[0].motion',
    });
  });

  it('still runs the placement rules beside a bad motion field elsewhere', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Nested beside a typo' },
      blocks: [
        {
          type: 'section',
          id: 'outer',
          title: 'Outer',
          motion: 'reveal-soft',
          blocks: [card('inner', 'reveal-soft'), card('typo', 'spin-forever')],
        },
      ],
    });
    expect(ruleIds(report)).toEqual(
      expect.arrayContaining(['motion/unknown-recipe', 'motion/nested-arrival']),
    );
    expect(ruleIds(report)).not.toContain('spec/invalid');
  });

  it('does not flag an arrival inside a block that carries no recipe', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Plain outer' },
      blocks: [
        { type: 'section', id: 'outer', title: 'Outer', blocks: [card('inner', 'reveal-soft')] },
      ],
    });
    expect(ruleIds(report)).not.toContain('motion/nested-arrival');
  });

  it('flags a stagger over more than eight items and states the cap', () => {
    const items = Array.from({ length: 9 }, (_, index) => ({ title: `T${index}`, text: 'x' }));
    const report = auditMotionSpec(spec({ type: 'steps', id: 'long', items, motion: 'stagger' }));
    expect(findingFor(report, 'motion/stagger-capped')).toMatchObject({
      severity: 'info',
      nodeId: 'long',
      evidence: '9 items',
    });
  });

  it('does not flag a stagger of eight items or fewer', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ title: `T${index}`, text: 'x' }));
    const report = auditMotionSpec(spec({ type: 'steps', id: 'fits', items, motion: 'stagger' }));
    expect(ruleIds(report)).not.toContain('motion/stagger-capped');
  });

  it('flags a state-change recipe whose condition reads state nothing writes', () => {
    const report = auditMotionSpec(
      spec(
        {
          type: 'kpi',
          id: 'orphan',
          items: [{ label: 'Seats', value: '4' }],
          visibleWhen: { path: 'state.never', equals: 'x' },
          motion: 'figure-roll',
        },
        { state: { never: 'y' } },
      ),
    );
    expect(findingFor(report, 'motion/state-never-changes')).toMatchObject({
      severity: 'warning',
      nodeId: 'orphan',
      evidence: 'state.never',
    });
  });

  it('does not flag a state-change recipe when a control writes the state it reads', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Written' },
      state: { plan: 'monthly' },
      blocks: [
        {
          type: 'radio-group',
          id: 'period',
          label: 'Period',
          bind: 'state.plan',
          options: [
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
          ],
        },
        {
          type: 'kpi',
          id: 'live',
          items: [{ label: 'Seats', value: '4' }],
          visibleWhen: { path: 'state.plan', equals: 'monthly' },
          motion: 'figure-roll',
        },
      ],
    });
    expect(ruleIds(report)).not.toContain('motion/state-never-changes');
  });

  it('flags more arrival recipes than the budget allows on one page', () => {
    const blocks = Array.from({ length: MOTION_ARRIVAL_BUDGET + 1 }, (_, index) =>
      card(`c${index}`, 'reveal-soft'),
    );
    const report = auditMotionSpec({ version: 1, meta: { title: 'Busy' }, blocks });
    expect(findingFor(report, 'motion/arrival-overuse')).toMatchObject({
      severity: 'warning',
      path: '$.blocks',
    });
  });

  it('allows exactly the arrival budget on one page', () => {
    const blocks = Array.from({ length: MOTION_ARRIVAL_BUDGET }, (_, index) =>
      card(`c${index}`, 'reveal-soft'),
    );
    const report = auditMotionSpec({ version: 1, meta: { title: 'Full' }, blocks });
    expect(ruleIds(report)).not.toContain('motion/arrival-overuse');
  });

  it('reports a theme whose motion policy plays no recipe, as information', () => {
    const report = auditMotionSpec(
      spec(card('a', 'reveal-soft'), {
        theme: { preset: 'editorial', tokens: { 'motion-policy': 'reduced' } },
      }),
    );
    expect(findingFor(report, 'motion/policy-off')).toMatchObject({
      severity: 'info',
      path: '$.theme',
      evidence: 'motion-policy: reduced',
    });
    expect(report.policy).toBe('reduced');
  });

  it('does not report the policy when the theme plays recipes in full', () => {
    const report = auditMotionSpec(spec(card('a', 'reveal-soft')));
    expect(ruleIds(report)).not.toContain('motion/policy-off');
    expect(report.policy).toBe('full');
  });
});

describe('spec audit: report shape', () => {
  it('counts findings by severity and scores them with the advisory weights', () => {
    const blocks = [
      {
        type: 'section',
        id: 'outer',
        title: 'Outer',
        motion: 'reveal-soft',
        blocks: [card('inner', 'reveal-soft')],
      },
      {
        type: 'steps',
        id: 'long',
        items: Array.from({ length: 9 }, (_, index) => ({ title: `T${index}`, text: 'x' })),
        motion: 'stagger',
      },
    ];
    const report = auditMotionSpec({ version: 1, meta: { title: 'Mixed' }, blocks });
    expect(report.counts).toEqual({ error: 0, warning: 1, info: 1 });
    expect(report.score).toEqual({ value: 90, weights: MOTION_SCORE_WEIGHTS });
    expect(report.mode).toBe('spec');
    expect(report.reliability).toBe('authoritative');
    expect(report.trusted).toBe(true);
  });

  it('subtracts one penalty per error, counted by severity weight', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Errors' },
      blocks: [card('a', 'ghost-one'), card('b', 'ghost-two')],
    });
    expect(report.counts).toEqual({ error: 2, warning: 0, info: 0 });
    expect(report.score.value).toBe(100 - 2 * MOTION_SCORE_WEIGHTS.error);
  });

  it('floors the score at zero', () => {
    const blocks = Array.from({ length: 5 }, (_, index) => card(`x${index}`, `ghost-${index}`));
    const report = auditMotionSpec({ version: 1, meta: { title: 'Floor' }, blocks });
    expect(report.counts.error).toBe(5);
    expect(report.score.value).toBe(0);
  });

  it('lists the recipes in use with the node that carries each', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Recipes' },
      blocks: [card('one', 'reveal-soft'), card('two')],
    });
    expect(report.recipes).toEqual([{ id: 'reveal-soft', nodeId: 'one' }]);
  });

  it('is deterministic: two runs over the same spec deep-equal each other', () => {
    const input = spec(card('a', 'spin-forever'), { theme: { preset: 'editorial' } });
    expect(auditMotionSpec(input)).toEqual(auditMotionSpec(input));
  });

  it('never changes the spec it audits', () => {
    const input = {
      version: 1,
      meta: { title: 'Pure' },
      blocks: [
        {
          type: 'section',
          id: 'outer',
          title: 'O',
          motion: 'reveal-soft',
          blocks: [card('i', 'reveal-soft')],
        },
      ],
    };
    const before = JSON.stringify(input);
    auditMotionSpec(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps the rule set on every fixture page free of warning and error findings', () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const report = auditMotionSpec(readText(`${FIXTURES}/${file}`), { source: file });
      const serious = report.findings.filter((finding) => finding.severity !== 'info');
      expect(serious, file).toEqual([]);
    }
  });

  it('audits the motion recipes fixture with its recipes recorded', () => {
    const report = auditMotionSpec(readText(`${FIXTURES}/motion-recipes.yaml`));
    expect(report.recipes.map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining(['reveal-soft', 'stagger', 'figure-roll', 'tabs-slide', 'dialog-pop']),
    );
    expect(report.findings).toEqual([]);
  });
});

describe('spec audit: golden report', () => {
  it('matches the committed projection for a spec that triggers three rules', () => {
    const report = auditMotionSpec({
      version: 1,
      meta: { title: 'Golden' },
      theme: { preset: 'editorial', tokens: { 'motion-policy': 'reduced' } },
      blocks: [
        {
          type: 'section',
          id: 'outer',
          title: 'Outer',
          motion: 'reveal-soft',
          blocks: [card('inner', 'reveal-soft')],
        },
        {
          type: 'steps',
          id: 'long',
          items: Array.from({ length: 9 }, (_, index) => ({ title: `T${index}`, text: 'x' })),
          motion: 'stagger',
        },
      ],
    });
    expect({
      counts: report.counts,
      score: report.score.value,
      policy: report.policy,
      findings: report.findings.map(({ rule, severity, path, nodeId, evidence }) => ({
        rule,
        severity,
        path,
        nodeId: nodeId ?? null,
        evidence: evidence ?? null,
      })),
    }).toEqual({
      counts: { error: 0, warning: 1, info: 2 },
      score: 88,
      policy: 'reduced',
      findings: [
        {
          rule: 'motion/nested-arrival',
          severity: 'warning',
          path: '$.blocks[0].blocks[0].motion',
          nodeId: 'inner',
          evidence: 'outer > inner',
        },
        {
          rule: 'motion/stagger-capped',
          severity: 'info',
          path: '$.blocks[1].motion',
          nodeId: 'long',
          evidence: '9 items',
        },
        {
          rule: 'motion/policy-off',
          severity: 'info',
          path: '$.theme',
          nodeId: null,
          evidence: 'motion-policy: reduced',
        },
      ],
    });
  });
});

describe('compiled HTML audit: clean baseline', () => {
  it('reports the real compiled motion recipes page as trusted with no error or warning', () => {
    const report = auditMotionHtml(readText(MOTION_GALLERY_PAGE));
    expect(report.mode).toBe('html');
    expect(report.reliability).toBe('best-effort');
    expect(report.trusted).toBe(true);
    expect(report.counts.error).toBe(0);
    expect(report.counts.warning).toBe(0);
    expect(report.recipes.map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining(['reveal-soft', 'tabs-slide', 'dialog-pop']),
    );
  });

  it('reads the root motion policy from the page, defaulting to full', () => {
    expect(auditMotionHtml(readText(MOTION_GALLERY_PAGE)).policy).toBe('full');
    expect(auditMotionHtml(htmlPage({ attributes: ' data-motion="reduced"' })).policy).toBe(
      'reduced',
    );
  });

  it('keeps every gallery page to information-level findings only', () => {
    const files = readdirSync(GALLERY).filter((name) => name.endsWith('.html'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const report = auditMotionHtml(readText(`${GALLERY}/${file}`));
      for (const finding of report.findings) {
        expect(finding.severity, `${file} ${finding.rule}`).toBe('info');
      }
    }
  });
});

describe('compiled HTML audit: provenance', () => {
  it('flags a page that does not name this compiler, and withholds the policy', () => {
    const report = auditMotionHtml(htmlPage({ generator: false }));
    expect(findingFor(report, 'html/untrusted-source')).toMatchObject({
      severity: 'info',
      path: 'html',
    });
    expect(report.trusted).toBe(false);
    expect(report.policy).toBeUndefined();
  });

  it('does not flag a page that names this compiler', () => {
    expect(ruleIds(auditMotionHtml(htmlPage({})))).not.toContain('html/untrusted-source');
  });
});

describe('compiled HTML audit: stylesheet rules', () => {
  it('flags an animation outside the motion guard', () => {
    const report = auditMotionHtml(htmlPage({ css: '.zz{animation:ak-m-fade 1s}' }));
    expect(findingFor(report, 'html/unguarded-motion')).toMatchObject({
      severity: 'error',
      path: 'css',
    });
  });

  it('flags a transition with a fixed time outside the motion guard', () => {
    const report = auditMotionHtml(htmlPage({ css: '.zz{transition:opacity 200ms}' }));
    expect(findingFor(report, 'html/unguarded-motion')?.severity).toBe('error');
  });

  it('flags a pseudo-state transition that moves with a fixed time outside the guard', () => {
    const report = auditMotionHtml(htmlPage({ css: '.btn:hover{transition:transform 200ms}' }));
    expect(findingFor(report, 'html/unguarded-motion')?.evidence).toContain('.btn:hover');
  });

  it('accepts a pseudo-state transition behind the guard', () => {
    const report = auditMotionHtml(
      htmlPage({ css: `${GUARD}{.btn:hover{transition:transform var(--ak-motion-duration)}}` }),
    );
    expect(ruleIds(report)).not.toContain('html/unguarded-motion');
  });

  it('accepts an animation wrapped in @supports inside the guard', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: `@supports (animation-timeline:view()){${GUARD}{.x{animation:ak-m-fade var(--ak-motion-duration)}}}@keyframes ak-m-fade{from{opacity:0}}`,
      }),
    );
    expect(ruleIds(report)).not.toContain('html/unguarded-motion');
  });

  it('accepts a print-only animation outside the guard', () => {
    const report = auditMotionHtml(htmlPage({ css: '@media print{.x{animation:ak-m-fade 1s}}' }));
    expect(ruleIds(report)).not.toContain('html/unguarded-motion');
  });

  it('accepts a scroll-position indicator on a scroll timeline outside the guard', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '.rail{animation:ak-reading linear both;animation-timeline:scroll()}@keyframes ak-reading{from{transform:scaleX(0)}to{transform:scaleX(1)}}',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/unguarded-motion');
  });

  it('flags a scroll-position name on an element without a scroll timeline', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '.rail{animation:ak-reading linear both}@keyframes ak-reading{to{opacity:1}}',
      }),
    );
    expect(findingFor(report, 'html/unguarded-motion')?.severity).toBe('error');
  });

  it('flags a keyframes name defined twice', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '@keyframes ak-m-fade{from{opacity:0}}@keyframes ak-m-fade{from{opacity:.5}}',
      }),
    );
    expect(findingFor(report, 'html/duplicate-keyframes')).toMatchObject({
      severity: 'error',
      evidence: '@keyframes ak-m-fade is defined 2 times',
    });
  });

  it('accepts keyframes with distinct names', () => {
    const report = auditMotionHtml(
      htmlPage({ css: '@keyframes ak-a{from{opacity:0}}@keyframes ak-b{from{opacity:0}}' }),
    );
    expect(ruleIds(report)).not.toContain('html/duplicate-keyframes');
  });

  it('accepts the same theme block repeated under a colour-scheme media query', () => {
    const block = ':root{--ak-color-text:#111;--ak-motion-duration:160ms}';
    const report = auditMotionHtml(
      htmlPage({
        css: `${block}@media (prefers-color-scheme:dark){${block}}:root[data-theme="dark"]{--ak-color-text:#eee}`,
      }),
    );
    expect(report.findings).toEqual([]);
  });

  it('flags transition: all, which also transitions layout and later properties', () => {
    const report = auditMotionHtml(
      htmlPage({ css: `${GUARD}{.zz{transition:all var(--ak-motion-duration) ease}}` }),
    );
    expect(findingFor(report, 'html/transition-all')).toMatchObject({ severity: 'warning' });
  });

  it('flags transition-property: all', () => {
    const report = auditMotionHtml(htmlPage({ css: '.zz{transition-property:all}' }));
    expect(ruleIds(report)).toContain('html/transition-all');
  });

  it('accepts a transition that lists its properties', () => {
    const report = auditMotionHtml(
      htmlPage({ css: '.zz{transition:opacity var(--ak-motion-duration) ease}' }),
    );
    expect(ruleIds(report)).not.toContain('html/transition-all');
  });

  it('flags a fixed-time guarded animation as information, and accepts a token-timed one', () => {
    const fixed = auditMotionHtml(htmlPage({ css: `${GUARD}{.x{animation:ak-m-fade 300ms}}` }));
    expect(findingFor(fixed, 'html/fixed-timing')).toMatchObject({ severity: 'info' });
    const token = auditMotionHtml(
      htmlPage({ css: `${GUARD}{.x{animation:ak-m-fade var(--ak-motion-duration)}}` }),
    );
    expect(ruleIds(token)).not.toContain('html/fixed-timing');
  });

  it('flags two or more infinite loops as information, and accepts one', () => {
    const two = auditMotionHtml(
      htmlPage({
        css: `${GUARD}{.a{animation:ak-spin 2s infinite}.b{animation:ak-pulse 2s infinite}}@keyframes ak-spin{to{opacity:1}}@keyframes ak-pulse{to{opacity:1}}`,
      }),
    );
    expect(findingFor(two, 'html/unbounded-motion')).toMatchObject({ severity: 'info' });
    const one = auditMotionHtml(
      htmlPage({
        css: `${GUARD}{.a{animation:ak-spin 2s infinite}}@keyframes ak-spin{to{opacity:1}}`,
      }),
    );
    expect(ruleIds(one)).not.toContain('html/unbounded-motion');
  });

  it('flags keyframes that animate layout properties as a warning', () => {
    const report = auditMotionHtml(
      htmlPage({ css: '@keyframes ak-zz{from{width:0}to{width:10px}}' }),
    );
    expect(findingFor(report, 'html/layout-keyframes')).toMatchObject({
      severity: 'warning',
      evidence: '@keyframes ak-zz',
    });
  });

  it('accepts keyframes that animate transform and opacity only', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '@keyframes ak-ok{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/layout-keyframes');
  });

  it('treats escaped class selectors as ordinary selectors for the guard check', () => {
    const outside = auditMotionHtml(htmlPage({ css: '.w-1\\/2{animation:ak-m-fade 1s}' }));
    expect(findingFor(outside, 'html/unguarded-motion')?.evidence).toContain('.w-1\\/2');
    const inside = auditMotionHtml(
      htmlPage({ css: `${GUARD}{.w-1\\/2{animation:ak-m-fade var(--ak-motion-duration)}}` }),
    );
    expect(ruleIds(inside)).not.toContain('html/unguarded-motion');
  });
});

describe('compiled HTML audit: markup and runtime rules', () => {
  it('flags a recipe name the compiler does not know, as a warning', () => {
    const report = auditMotionHtml(htmlPage({ body: '<div data-ak-motion="made-up"></div>' }));
    expect(findingFor(report, 'html/unknown-recipe')).toMatchObject({
      severity: 'warning',
      evidence: 'data-ak-motion="made-up"',
    });
  });

  it('flags a known recipe applied in markup with no stylesheet rules', () => {
    const report = auditMotionHtml(htmlPage({ body: '<div data-ak-motion="reveal-soft"></div>' }));
    expect(findingFor(report, 'html/missing-recipe-css')).toMatchObject({
      severity: 'error',
      recipe: 'reveal-soft',
    });
  });

  it('accepts a known recipe whose stylesheet rules are present', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '[data-ak-motion="reveal-soft"]{opacity:1}',
        body: '<div data-ak-motion="reveal-soft"></div>',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/missing-recipe-css');
  });

  it('flags tabs-slide shipped without its lifecycle runtime', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '[data-ak-motion="tabs-slide"]{opacity:1}',
        body: '<div data-ak-motion="tabs-slide"></div>',
        script: 'console.log(1);',
      }),
    );
    expect(findingFor(report, 'html/missing-lifecycle')).toMatchObject({
      severity: 'error',
      recipe: 'tabs-slide',
      evidence: 'wireTabMotion',
    });
  });

  it('accepts tabs-slide when the runtime carries its lifecycle marker', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '[data-ak-motion="tabs-slide"]{opacity:1}',
        body: '<div data-ak-motion="tabs-slide"></div>',
        script: 'function wireTabMotion(){}',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/missing-lifecycle');
  });

  it('flags a dialog-pop dialog shipped without its exit phase', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '[data-ak-motion="dialog-pop"]{opacity:1}',
        body: '<dialog data-ak-motion="dialog-pop"></dialog>',
        script: 'console.log(1);',
      }),
    );
    expect(findingFor(report, 'html/missing-exit')).toMatchObject({
      severity: 'error',
      recipe: 'dialog-pop',
      evidence: 'data-ak-leaving',
    });
  });

  it('accepts a dialog-pop dialog whose runtime carries the exit marker', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '[data-ak-motion="dialog-pop"]{opacity:1}',
        body: '<dialog data-ak-motion="dialog-pop"></dialog>',
        script: 'el.setAttribute("data-ak-leaving", "")',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/missing-exit');
  });

  it('flags a page with no Content-Security-Policy', () => {
    const report = auditMotionHtml(htmlPage({ csp: null }));
    expect(findingFor(report, 'html/missing-csp')).toMatchObject({ severity: 'error' });
  });

  it('flags a CSP that allows unsafe-inline or unsafe-eval', () => {
    const inline = auditMotionHtml(
      htmlPage({ csp: "default-src 'none'; style-src 'unsafe-inline'" }),
    );
    expect(findingFor(inline, 'html/unsafe-csp')).toMatchObject({ severity: 'error' });
    const evaluated = auditMotionHtml(
      htmlPage({ csp: "default-src 'none'; script-src 'unsafe-eval'" }),
    );
    expect(ruleIds(evaluated)).toContain('html/unsafe-csp');
  });

  it('accepts a nonce-based CSP', () => {
    const report = auditMotionHtml(htmlPage({ csp: "default-src 'none'; script-src 'nonce-x'" }));
    expect(report.findings).toEqual([]);
  });

  it('flags a script, stylesheet, @import or url() that loads from outside the file', () => {
    const cases: [string, string][] = [
      [
        '<script src="https://cdn.example.com/x.js"></script>',
        '<script src="https://cdn.example.com/x.js">',
      ],
      [
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
        'href="https://cdn.example.com/x.css"',
      ],
    ];
    for (const [head, evidence] of cases) {
      const report = auditMotionHtml(htmlPage({ head }));
      const finding = report.findings.find((item) => item.rule === 'html/remote-resource');
      expect(finding?.severity).toBe('error');
      expect(finding?.evidence).toContain(evidence);
    }
    const imported = auditMotionHtml(
      htmlPage({ css: '@import url(https://cdn.example.com/x.css);' }),
    );
    expect(ruleIds(imported)).toContain('html/remote-resource');
    const remoteUrl = auditMotionHtml(
      htmlPage({ css: '.zz{background:url(//cdn.example.com/x.png)}' }),
    );
    expect(ruleIds(remoteUrl)).toContain('html/remote-resource');
  });

  it('accepts inline data URLs and same-file references', () => {
    const report = auditMotionHtml(
      htmlPage({
        css: '.zz{background:url(data:image/gif;base64,R0lGOD)}',
        body: '<a href="#top">x</a>',
      }),
    );
    expect(ruleIds(report)).not.toContain('html/remote-resource');
  });
});

describe('motion gate and baseline helpers', () => {
  const finding = (severity: MotionSeverity, rule = `test/${severity}`): MotionFinding => ({
    rule,
    severity,
    message: 'm',
    path: '$.x',
    fix: 'f',
  });
  const one: MotionFinding[] = [finding('error'), finding('warning'), finding('info')];

  it('fails at a level only when a finding is at that level or more serious', () => {
    expect(motionAuditFails([finding('error')], 'error')).toBe(true);
    expect(motionAuditFails([finding('warning')], 'error')).toBe(false);
    expect(motionAuditFails([finding('warning')], 'warning')).toBe(true);
    expect(motionAuditFails([finding('info')], 'warning')).toBe(false);
    expect(motionAuditFails([finding('info')], 'info')).toBe(true);
    expect(motionAuditFails(one, 'error')).toBe(true);
  });

  it('never fails with failOn none, whatever the findings', () => {
    expect(motionAuditFails(one, 'none')).toBe(false);
    expect(motionAuditFails([], 'none')).toBe(false);
  });

  it('passes an empty finding list at every level', () => {
    for (const level of ['error', 'warning', 'info', 'none'] as const) {
      expect(motionAuditFails([], level)).toBe(false);
    }
  });

  it('identifies a finding by rule, path, node and evidence, not by its prose', () => {
    const base = { ...finding('warning', 'motion/x'), nodeId: 'n', evidence: 'e' };
    expect(motionFindingKey({ ...base, message: 'other words', fix: 'other fix' })).toBe(
      motionFindingKey(base),
    );
    expect(motionFindingKey({ ...base, evidence: 'changed' })).not.toBe(motionFindingKey(base));
  });

  it('reports findings added since a baseline and findings the baseline held that are gone', () => {
    const a = finding('warning', 'motion/a');
    const b = finding('info', 'motion/b');
    const c = finding('error', 'motion/c');
    const comparison = compareMotionAudits({ findings: [a, b] }, { findings: [b, c] });
    expect(comparison.added.map((item) => item.rule)).toEqual(['motion/c']);
    expect(comparison.resolved.map((item) => item.rule)).toEqual(['motion/a']);
  });

  it('reports nothing added or resolved for the same findings with new wording', () => {
    const before = [{ ...finding('warning', 'motion/a'), message: 'old' }];
    const after = [{ ...finding('warning', 'motion/a'), message: 'new' }];
    expect(compareMotionAudits({ findings: before }, { findings: after })).toEqual({
      added: [],
      resolved: [],
    });
  });

  it('keeps a finding on a named block stable when other blocks move', () => {
    const nested = {
      type: 'section',
      id: 'outer',
      title: 'Outer',
      motion: 'reveal-soft',
      blocks: [card('inner', 'reveal-soft')],
    };
    const before = auditMotionSpec({ ...spec(nested), blocks: [nested] });
    const after = auditMotionSpec({ ...spec(nested), blocks: [card('new-first'), nested] });
    expect(before.findings.length).toBeGreaterThan(0);
    expect(after.findings.map((item) => item.path)).not.toEqual(
      before.findings.map((item) => item.path),
    );
    expect(compareMotionAudits(before, after)).toEqual({ added: [], resolved: [] });
  });

  it('compares a real audit against its own report as no change', () => {
    const report = auditMotionSpec(spec(card('a', 'spin-forever')));
    expect(compareMotionAudits(report, report)).toEqual({ added: [], resolved: [] });
  });
});

describe('compiled HTML audit: hostile input', () => {
  // Each input once took quadratic time or ran out of memory. Linear work
  // finishes well inside the bound even on a slow CI runner.
  const cases: [string, string][] = [
    ['unclosed style tags', '<style>'.repeat(150_000)],
    ['unclosed script tags', '<script>'.repeat(150_000)],
    ['html tags with no end', '<html '.repeat(150_000)],
    ['link tags with no end', '<link '.repeat(150_000)],
    ['url() with no close', `<style>${'url(//'.repeat(150_000)}</style>`],
    ['deeply nested blocks', `<style>${'a{'.repeat(400_000)}</style>`],
    ['many keyframes', `<style>${'@keyframes k{0%{opacity:0}}'.repeat(20_000)}</style>`],
    [
      'a long media prelude over many declarations',
      `<style>@media ${'x'.repeat(400_000)}{a{${'b:c;'.repeat(100_000)}}}</style>`,
    ],
    ['one transition with many layers', `<style>a{transition:${'all,'.repeat(250_000)}}</style>`],
    [
      'a long selector with many transitions',
      `<style>${'a'.repeat(500_000)}{${'transition:all;'.repeat(30_000)}}</style>`,
    ],
    [
      'a long selector with many animations',
      `<style>${'a'.repeat(500_000)}{${'animation:spin 1s;'.repeat(25_000)}}</style>`,
    ],
    [
      'many blocks under a long prelude',
      `<style>@media ${'x'.repeat(400_000)}{${'a{animation-timeline:scroll()}'.repeat(20_000)}}</style>`,
    ],
    ['a flood of empty blocks', `<style>${'{}'.repeat(500_000)}</style>`],
    ['a flood of nested empty rules', `<style>${'a{b{}}'.repeat(160_000)}</style>`],
    [
      'a long digit run in a transition',
      `<style>a{transition:opacity (${'1'.repeat(900_000)}}</style>`,
    ],
    [
      'a long zero run in a transition',
      `<style>a{transition:opacity (${'0'.repeat(900_000)}}</style>`,
    ],
    [
      'a long digit run in a guarded animation',
      `<style>@media (prefers-reduced-motion:no-preference){a{animation:x (${'1'.repeat(900_000)}}}</style>`,
    ],
  ];
  it.each(cases)('audits %s in linear time and bounded output', (_name, html) => {
    const started = performance.now();
    const report = auditMotionHtml(html);
    expect(report.mode).toBe('html');
    expect(performance.now() - started).toBeLessThan(5_000);
    // The report stays small whatever the page holds.
    expect(JSON.stringify(report).length).toBeLessThan(200_000);
  });

  it('grows linearly when the hostile input grows', () => {
    // The fastest of three runs, so a pause from other work does not count.
    const elapsed = (size: number) => {
      const html = `<style>${'a{b{}}'.repeat(size)}a{transition:opacity (${'1'.repeat(size * 6)}}</style>`;
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        auditMotionHtml(html);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = Math.max(elapsed(40_000), 50);
    // Quadratic work would take sixteen times as long at four times the size.
    expect(elapsed(160_000) / small).toBeLessThan(10);
  });

  it('fails a stylesheet nested too deeply to check instead of skipping it', () => {
    const css = `${'@supports (display:grid){'.repeat(40)}.a{animation:spin 1s infinite}`;
    const finding = findingFor(auditMotionHtml(htmlPage({ css })), 'html/unguarded-motion');
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('nests blocks deeper than');
  });

  it('lists a bounded number of findings per rule but counts every one', () => {
    const css = Array.from({ length: 60 }, (_, index) => `.r${index}{transition:all 1s}`).join('');
    const report = auditMotionHtml(htmlPage({ css }));
    const listed = report.findings.filter((item) => item.rule === 'html/transition-all');
    expect(listed).toHaveLength(MOTION_FINDINGS_PER_RULE + 1);
    const omitted = 60 - MOTION_FINDINGS_PER_RULE;
    expect(
      listed.some((item) =>
        new RegExp(`^${omitted} more, [0-9a-f]{8}$`, 'u').test(item.evidence ?? ''),
      ),
    ).toBe(true);
    expect(report.counts.warning).toBe(60);
  });

  it('shows a baseline a change among the unlisted findings', () => {
    const page = (selectors: string[]) =>
      htmlPage({
        css: selectors
          .map((selector) => `${selector}{transition:all var(--ak-motion-duration)}`)
          .join(''),
      });
    const selectors = Array.from(
      { length: 30 },
      (_, index) => `.s${String(index).padStart(2, '0')}`,
    );
    const baseline = auditMotionHtml(page(selectors));
    const swapped = auditMotionHtml(page([...selectors.slice(0, -1), '.zz-new']));
    expect(swapped.counts).toEqual(baseline.counts);
    const { added } = compareMotionAudits(baseline, swapped);
    expect(added.map((item) => item.rule)).toEqual(['html/transition-all']);
    expect(motionAuditFails(added, 'warning')).toBe(true);
    expect(compareMotionAudits(baseline, auditMotionHtml(page(selectors)))).toEqual({
      added: [],
      resolved: [],
    });
  });

  it('reports transition: all once per declaration', () => {
    const report = auditMotionHtml(htmlPage({ css: '.a{transition:all 1s,all 2s,all 3s}' }));
    expect(report.findings.filter((item) => item.rule === 'html/transition-all')).toHaveLength(1);
  });

  it('finds a remote resource behind a quoted > in an earlier attribute', () => {
    const head =
      '<link title="a>b" rel="stylesheet" href="//evil.example/x.css"><script data-x=">" src="//evil.example/x.js"></script>';
    const report = auditMotionHtml(htmlPage({ head }));
    const remote = report.findings.filter((item) => item.rule === 'html/remote-resource');
    expect(remote.map((item) => item.evidence).join(' ')).toContain('evil.example/x.css');
    expect(remote.map((item) => item.evidence).join(' ')).toContain('evil.example/x.js');
  });
});

describe('compiled HTML audit: shorthand, counts and logical properties', () => {
  it('names each loop in a shorthand that starts with its duration', () => {
    const css =
      '@media (prefers-reduced-motion:no-preference){.a{animation:1s linear infinite spin}.b{animation:2s ease-in-out infinite pulse}.c{animation:300ms infinite wobble}}';
    const finding = findingFor(auditMotionHtml(htmlPage({ css })), 'html/unbounded-motion');
    expect(finding?.evidence).toBe('pulse, spin, wobble');
  });

  it('never takes an easing or var() function for the loop name', () => {
    const css =
      '@media (prefers-reduced-motion:no-preference){.a{animation:1s cubic-bezier(.2,0,0,1) infinite spin}.b{animation:2s steps(2,end) infinite pulse}.c{animation:1s infinite var(--d) ak-wave}}';
    const finding = findingFor(auditMotionHtml(htmlPage({ css })), 'html/unbounded-motion');
    expect(finding?.evidence).toBe('ak-wave, pulse, spin');
  });

  it('counts recipe uses in the markup, not in stylesheet selectors', () => {
    const html = readText(MOTION_GALLERY_PAGE);
    const markup = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gu, '');
    const report = auditMotionHtml(html);
    expect(report.recipes.length).toBeGreaterThanOrEqual(7);
    for (const recipe of report.recipes) {
      const uses = markup.split(`data-ak-motion="${recipe.id}"`).length - 1;
      expect(recipe.count, recipe.id).toBe(uses);
    }
    expect(report.recipes.find((recipe) => recipe.id === 'stagger')?.count).toBe(1);
  });

  it('treats logical margin, padding and inset properties as layout', () => {
    const css =
      '@keyframes ak-x{from{margin-inline-start:0;padding-block-end:0;inset-inline-start:0}to{opacity:1}}';
    const finding = findingFor(auditMotionHtml(htmlPage({ css })), 'html/layout-keyframes');
    expect(finding?.message).toContain('margin-inline-start');
    expect(finding?.message).toContain('padding-block-end');
    expect(finding?.message).toContain('inset-inline-start');
  });
});
