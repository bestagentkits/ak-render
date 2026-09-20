import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CompileResult, compile } from '../../src/render/render.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const fixtures = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({ name, source: readFileSync(`${pagesDir}/${name}`, 'utf8') }));

function byName(name: string): CompileResult {
  const fixture = fixtures.find((entry) => entry.name === name);
  if (fixture === undefined) throw new Error(`missing fixture ${name}`);
  return compile(fixture.source, { source: fixture.name });
}

describe('emitted accessibility and structure invariants', () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      const result = compile(fixture.source, { source: fixture.name });
      const { html } = result;

      it('has exactly one h1 and a main landmark', () => {
        expect(html.match(/<h1[\s>]/gu)?.length ?? 0).toBe(1);
        expect(html).toContain('<main');
        expect(html).toContain('id="ak-main-content"');
      });

      it('declares a language, a title, and a skip link', () => {
        expect(html).toMatch(/<html[^>]+lang="en"/u);
        expect(html).toContain(`<title>${result.ir.meta.title.replace(/&/gu, '&amp;')}</title>`);
        expect(html).toContain('class="ak-skip"');
      });

      it('gives every table a header row and scoped headers', () => {
        const tables = html.match(/<table\b/gu)?.length ?? 0;
        expect(html.match(/<thead>/gu)?.length ?? 0).toBe(tables);
        expect(html).not.toMatch(/<th(?=[\s>])(?![^>]*scope=)[^>]*>/iu);
      });

      it('gives every image alt text and every button an explicit type', () => {
        for (const image of html.match(/<img\b[^>]*>/gu) ?? []) {
          expect(image).toMatch(/\salt="/u);
        }
        for (const button of html.match(/<button\b[^>]*>/gu) ?? []) {
          expect(button).toMatch(/\stype="button"/u);
        }
      });

      it('keeps focus visible and respects reduced motion', () => {
        expect(html).toContain(':focus-visible');
        expect(html).toContain('prefers-reduced-motion');
      });

      it('constrains layout responsively without inline styles', () => {
        expect(html).toMatch(/@media \(max-width:768px\)/u);
        expect(html).toMatch(/@media \(max-width:480px\)/u);
        expect(html).not.toMatch(/\sstyle="/iu);
      });

      it('resolves every action target to exactly one element', () => {
        const ids = [...html.matchAll(/data-ak-id="([^"]+)"/gu)].map((match) => match[1] ?? '');
        expect(new Set(ids).size).toBe(ids.length);
        for (const binding of html.matchAll(/data-ak-on-[a-z]+="([^"]+)"/gu)) {
          const raw = (binding[1] ?? '').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
          for (const action of JSON.parse(raw) as { target?: string }[]) {
            if (action.target === undefined) continue;
            expect(ids, `target ${action.target} must exist`).toContain(action.target);
          }
        }
      });
    });
  }
});

describe('feature tree-shaking', () => {
  it('ships carousel CSS and JS only when a carousel is present', () => {
    const withCarousel = byName('interactive.yaml');
    const withoutCarousel = byName('dashboard.yaml');
    expect(withCarousel.html).toContain('.ak-carousel{');
    expect(withCarousel.html).toContain('wireCarousels');
    expect(withoutCarousel.html).not.toContain('.ak-carousel{');
    expect(withoutCarousel.html).not.toContain('wireCarousels');
  });

  it('ships tab and slider behavior only when used', () => {
    const interactive = byName('interactive.yaml');
    expect(interactive.html).toContain('wireTabs');
    expect(interactive.html).toContain('wireSliders');
    expect(interactive.features).toContain('tabs');
    expect(interactive.features).toContain('slider');

    const plan = byName('plan.yaml');
    expect(plan.html).not.toContain('wireTabs');
    expect(plan.html).not.toContain('wireSliders');
    expect(plan.features).not.toContain('tabs');
  });

  it('ships chart markup only for pages with charts', () => {
    expect(byName('dashboard.yaml').html).toContain('ak-chart');
    expect(byName('explain.yaml').html).not.toContain('.ak-chart{');
  });

  it('ships the filter runtime only when a search or list binding exists', () => {
    expect(byName('interactive.yaml').html).toContain('wireFilters');
    expect(byName('diff.yaml').html).not.toContain('wireFilters');
  });

  it('always ships the theme toggle and its runtime, because AgentKit pages require it', () => {
    for (const fixture of fixtures) {
      const result = compile(fixture.source, { source: fixture.name });
      expect(result.html, fixture.name).toContain('data-ak-theme-toggle');
      expect(result.features, fixture.name).toContain('theme');
    }
  });
});

describe('fixture compilation', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} compiles deterministically`, () => {
      const first = compile(fixture.source, { source: fixture.name });
      const second = compile(fixture.source, { source: fixture.name });
      expect(first.html).toBe(second.html);
      expect(first.hash).toBe(second.hash);
      expect(first.bytes).toBe(first.html.length);
      expect(first.warnings.length).toBeGreaterThanOrEqual(0);
    });
  }
});
