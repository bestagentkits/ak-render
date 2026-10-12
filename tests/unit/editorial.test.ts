import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { parseSpec } from '../../src/spec/parse.js';
import { validate } from '../../src/spec/validate.js';

const PRESET = `theme:
  preset: newspaper
`;

function page(blocks: string, theme = PRESET): string {
  return `version: 1
meta:
  title: Editorial fixture
${theme}policy:
  network: deny
blocks:
${blocks}`;
}

const FULL = `  - type: publication-header
    name: The Chronicle
    date: '2026-10-12'
    issue: No. 1
    sections: [Tech, { label: Business, href: '#biz' }]
  - type: editorial-layout
    lead:
      - type: story
        prominence: lead
        title: Lead headline
        body: |
          First paragraph.

          Second paragraph.
    secondary:
      - type: story
        title: Second
    aside:
      - type: digest-list
        title: Diary
        items:
          - { date: '2026-10-12', title: One, text: Line }
`;

describe('editorial blocks', () => {
  it('renders the masthead, regions and stories in DOM reading order', () => {
    const { html, features } = compile(page(FULL));
    expect(html).toContain('class="ak-block ak-masthead"');
    expect(html).toContain('aria-label="Sections"');
    expect(html).toContain('data-regions="lead secondary aside"');
    const lead = html.indexOf('ak-bs-lead');
    const secondary = html.indexOf('ak-bs-secondary');
    const aside = html.indexOf('ak-bs-aside');
    expect(lead).toBeLessThan(secondary);
    expect(secondary).toBeLessThan(aside);
    expect(features).toEqual(expect.arrayContaining(['masthead', 'story', 'broadsheet']));
    expect(html).toContain('data-r-page="broadsheet"');
    expect(html).toContain('data-r-sections="newspaper"');
    expect(html).toContain(
      '.ak-story[data-prominence="lead"] .ak-story-body > p:first-child::first-letter',
    );
  });

  it('is deterministic and uses the masthead as the page heading', () => {
    expect(compile(page(FULL)).html).toBe(compile(page(FULL)).html);
    expect(compile(page(FULL)).html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('escapes supplied text instead of passing markup through', () => {
    const { html } = compile(
      page(`  - type: story
    title: '<img src=x onerror=alert(1)>'
    summary: '<script>boom()</script>'
`),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>boom');
    expect(html).toContain('&lt;img src=x');
  });

  it('copes with every optional field missing and a lead-only layout', () => {
    const { html } = compile(
      page(`  - type: publication-header
    name: Bare
  - type: editorial-layout
    lead:
      - type: story
        title: Only a headline
`),
    );
    expect(html).toContain('data-regions="lead"');
    expect(html).not.toContain('aria-label="Sections"');
    expect(html).not.toContain('<aside class="ak-bs-aside"');
  });

  it('requires alt text when a story has an image', () => {
    const result = validate(
      parseSpec(
        page(`  - type: story
    title: Photo
    image: https://example.org/a.png
`),
      ),
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('$.blocks[0].alt');
  });

  it('keeps the editorial recipe CSS out of pages that do not use the newspaper preset', () => {
    const { html } = compile(page(FULL, ''));
    expect(html).not.toContain('data-r-page=');
    expect(html).not.toContain('data-r-atmosphere=');
  });

  it('keeps existing presets free of the new recipe surfaces', () => {
    const { html } = compile(`version: 1
meta:
  title: Plain
theme:
  preset: swiss-clean
blocks:
  - type: hero
    title: Plain page
`);
    expect(html).not.toContain('data-r-page=');
    expect(html).not.toContain('data-r-atmosphere=');
    expect(html).not.toContain('first-letter');
  });

  it('suppresses decorative effects under the print atmosphere', () => {
    const { html } = compile(page(FULL));
    expect(html).toContain('data-r-atmosphere="print"');
    expect(html).toMatch(/html\[data-r-atmosphere="print"\][^{]*\.ak-word/);
  });
});

describe('editorial page heading', () => {
  const header = '  - type: publication-header\n    name: The Chronicle\n';

  it.each([
    ['a hero', '  - type: hero\n    title: Another banner\n'],
    ['a level-1 heading', '  - type: heading\n    level: 1\n    text: Another\n'],
    ['a second masthead', header],
  ])('rejects %s next to a masthead with a pointed diagnostic', (_name, extra) => {
    const result = validate(parseSpec(page(header + extra)));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('$.blocks[1]');
  });

  it('does not warn about the first heading after a masthead', () => {
    const result = validate(
      parseSpec(page(`${header}  - type: heading\n    level: 2\n    text: Section\n`)),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('first heading');
  });

  it('keeps the photo after the headline in the DOM', () => {
    const { html } = compile(
      page(`  - type: story
    title: Cranes
    image: https://example.org/a.png
    alt: Cranes
`),
    );
    expect(html.indexOf('<h2 class="ak-story-title"')).toBeLessThan(
      html.indexOf('<figure class="ak-story-photo">'),
    );
  });
});
