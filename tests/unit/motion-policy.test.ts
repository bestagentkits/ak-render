import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyMotionPolicy,
  MOTION_ALLOWED,
  motionDiagnostics,
  motionPolicyOf,
  PRINT_STILL_CSS,
  RESTRAINED_CSS,
} from '../../src/render/motion.js';
import { compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));

const SPEC = `version: 1
meta:
  title: Motion fixture
blocks:
  - type: hero
    title: Motion fixture
  - type: marquee
    items: [One, Two]
`;

const withPolicy = (policy: string) =>
  compile(SPEC, { theme: { preset: 'editorial', tokens: { 'motion-policy': policy } } }).html;

describe('motion diagnostics', () => {
  it('accepts an animation behind the motion guard', () => {
    expect(
      motionDiagnostics(`@media ${MOTION_ALLOWED}{.a{animation:ak-x 1s both}}@keyframes ak-x{}`),
    ).toEqual([]);
  });

  it('rejects an unguarded time-based animation', () => {
    expect(motionDiagnostics('.a{animation:ak-x 1s both}@keyframes ak-x{}')).toEqual([
      `animation ak-x on .a is not behind ${MOTION_ALLOWED}`,
    ]);
  });

  it('allows a scroll-position indicator only on a scroll timeline', () => {
    const onScroll =
      '@supports (animation-timeline:scroll()){.r{animation:ak-reading linear both;animation-timeline:scroll(root)}}@keyframes ak-reading{}';
    expect(motionDiagnostics(onScroll)).toEqual([]);
    expect(
      motionDiagnostics('.r{animation:ak-reading 1s both}@keyframes ak-reading{}'),
    ).toHaveLength(1);
  });

  it('finds the scroll timeline in another rule for the same selector or past a nested rule', () => {
    expect(
      motionDiagnostics('.r{animation:ak-reading linear both}.r{animation-timeline:scroll(root)}'),
    ).toEqual([]);
    expect(
      motionDiagnostics(
        '.r{animation-timeline:scroll(root);&:hover{color:red}animation:ak-reading linear both}',
      ),
    ).toEqual([]);
    expect(
      motionDiagnostics('.a{animation-timeline:scroll(root)}.r{animation:ak-reading linear both}'),
    ).toHaveLength(1);
  });

  it('rejects a keyframes name defined twice', () => {
    expect(motionDiagnostics('@keyframes ak-x{}@keyframes ak-x{}')).toEqual([
      '@keyframes ak-x is defined 2 times',
    ]);
  });

  it('checks every animation layer, not only the first', () => {
    const rail =
      '.r{animation:ak-reading linear both,ak-aurora 18s infinite;animation-timeline:scroll(root)}';
    expect(motionDiagnostics(rail)).toEqual([
      `animation ak-aurora on .r is not behind ${MOTION_ALLOWED}`,
    ]);
    expect(motionDiagnostics('.a{animation-name:ak-x,ak-y}')).toHaveLength(2);
  });

  it('does not accept the guard inside a media query list that matches without it', () => {
    expect(
      motionDiagnostics(`@media (min-width:0),${MOTION_ALLOWED}{.a{animation:ak-x 1s}}`),
    ).toHaveLength(1);
    expect(
      motionDiagnostics(`@media ${MOTION_ALLOWED} and (hover:hover){.a{animation:ak-x 1s}}`),
    ).toEqual([]);
    expect(
      motionDiagnostics(`@media not all and ${MOTION_ALLOWED}{.a{animation:ak-x 1s}}`),
    ).toHaveLength(1);
  });

  it('requires unguarded transitions to use the duration token', () => {
    expect(motionDiagnostics('.a{transition:color var(--ak-transition)}')).toEqual([]);
    expect(
      motionDiagnostics('.a{transition:opacity calc(var(--ak-motion-duration) * 2) ease}'),
    ).toEqual([]);
    expect(motionDiagnostics('.a{transition:none!important}')).toEqual([]);
    expect(motionDiagnostics('.a{transition:translate .9s ease}')).toHaveLength(1);
    expect(
      motionDiagnostics('.a{transition:color var(--ak-transition),transform 200ms ease}'),
    ).toHaveLength(1);
    // Only the duration token makes a time zero in the still state; easing does not.
    expect(
      motionDiagnostics('.a{transition:transform 600ms var(--ak-motion-easing)}'),
    ).toHaveLength(1);
    expect(motionDiagnostics('.a{transition-delay:2s}')).toHaveLength(1);
    expect(motionDiagnostics('.a{transition-delay:0s}')).toEqual([]);
    expect(motionDiagnostics('.a{transition:opacity 0.0s,color .0s calc(0ms)}')).toEqual([]);
    expect(motionDiagnostics('.a{transition:opacity calc(1s*2)}')).toHaveLength(1);
    expect(motionDiagnostics('.a{transition:opacity 1.5s}')).toHaveLength(1);
    expect(motionDiagnostics('.a{transition:opacity x1s}')).toEqual([]);
    // Any other variable may hold a fixed time, directly or as its fallback.
    expect(motionDiagnostics('.a{transition:translate var(--ak-marquee-time)}')).toHaveLength(1);
    expect(motionDiagnostics('.a{transition:translate var(--ak-nope, 900ms)}')).toHaveLength(1);
    expect(motionDiagnostics(`@media ${MOTION_ALLOWED}{.a{transition:translate .9s}}`)).toEqual([]);
  });

  it('holds for every fixture page', () => {
    for (const file of readdirSync(pagesDir).filter((name) => name.endsWith('.yaml'))) {
      const html = compile(readFileSync(`${pagesDir}/${file}`, 'utf8'), { source: file }).html;
      const css = /<style[^>]*>([\s\S]*?)<\/style>/u.exec(html)?.[1] ?? '';
      expect(motionDiagnostics(css), file).toEqual([]);
    }
  });
});

describe('motion policy', () => {
  it('reads unknown or missing policies as full', () => {
    expect(motionPolicyOf(undefined)).toBe('full');
    expect(motionPolicyOf('reduced')).toBe('reduced');
    expect(motionPolicyOf('none')).toBe('none');
    expect(applyMotionPolicy(`@media ${MOTION_ALLOWED}{}`, 'full')).toBe(
      `@media ${MOTION_ALLOWED}{}`,
    );
  });

  it('keeps every guarded animation under full', () => {
    const html = withPolicy('full');
    expect(html).not.toContain('data-motion=');
    expect(html).toContain(`@media ${MOTION_ALLOWED}{`);
  });

  it('restrains reduced: no guarded motion, but token-timed feedback keeps its duration', () => {
    const html = withPolicy('reduced');
    expect(html).toContain('data-motion="reduced"');
    expect(html).not.toMatch(
      /\(prefers-reduced-motion:no-preference\)(?! and \(prefers-reduced-motion:reduce\))/u,
    );
    // Only the system setting zeroes the duration; the theme leaves it alone.
    expect(html.match(/--ak-motion-duration:0ms/gu)).toHaveLength(1);
    expect(html).toContain('@media (prefers-reduced-motion: reduce){');
  });

  it('stills none outright', () => {
    const html = withPolicy('none');
    expect(html).toContain('data-motion="none"');
    expect(html.match(/--ak-motion-duration:0ms/gu)).toHaveLength(2);
  });

  it('gives the dialog its own keyframes, so the hero word reveal keeps its own', () => {
    const source = readFileSync(`${pagesDir}/interactive.yaml`, 'utf8');
    const html = compile(source, { source: 'interactive.yaml' }).html;
    expect(html.match(/@keyframes ak-rise\{/gu)).toHaveLength(1);
    expect(html).toContain('@keyframes ak-dialog-in{');
    expect(html).toContain(
      `@media ${MOTION_ALLOWED}{dialog.ak-dialog[open]{animation:ak-dialog-in`,
    );
  });

  it('settles every page in print under any policy', () => {
    for (const policy of ['full', 'reduced', 'none']) {
      expect(withPolicy(policy)).toContain(PRINT_STILL_CSS);
    }
  });

  it('limits restrained transitions to properties that do not move anything', () => {
    expect(withPolicy('reduced')).toContain(RESTRAINED_CSS);
    expect(withPolicy('full')).not.toContain(RESTRAINED_CSS);
    expect(withPolicy('none')).not.toContain(RESTRAINED_CSS);
  });
});
