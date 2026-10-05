import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_FONTS } from '../../src/render/embedded-fonts.generated.js';
import { compile } from '../../src/render/render.js';
import { verifyDocument } from '../../src/render/verify.js';

const fontsDir = fileURLToPath(new URL('../../assets/fonts', import.meta.url));

function page(text: string, theme = 'preset: blueprint'): string {
  return `version: 1
meta:
  title: Font fixture
theme:
  ${theme}
blocks:
  - type: text
    text: ${text}
`;
}

const faces = (html: string): string[] =>
  [...html.matchAll(/@font-face\{font-family:"([^"]+)"[^}]*unicode-range:U\+([\w-]+)/gu)].map(
    (match) => `${match[1]}:${match[2]}`,
  );

describe('embedded fonts', () => {
  it('inlines the latin subset of the face a preset names, and opens font-src to data:', () => {
    const { html } = compile(page('An English page.'));
    expect(faces(html)).toEqual(['AK Geist:0000-00FF']);
    expect(html).toContain('src:url(data:font/woff2;base64,');
    expect(html).toContain('font-src data:;');
    expect(html).toContain('SIL Open Font License 1.1');
    expect(html).toMatch(/--ak-font-heading:AK Geist, ui-sans-serif/u);
  });

  it('adds the Vietnamese subset only when the page text needs it', () => {
    const { html } = compile(page('Trình biên dịch tạo một tệp duy nhất.'));
    expect(faces(html)).toEqual(['AK Geist:0000-00FF', 'AK Geist:0102-0103']);
  });

  it('detects Vietnamese written with combining marks', () => {
    const { html } = compile(page('Việt'));
    expect(faces(html)).toContain('AK Geist:0102-0103');
  });

  it('emits only the faces a theme names', () => {
    expect(faces(compile(page('Serif.', 'preset: editorial')).html)).toEqual([
      'AK Fraunces:0000-00FF',
    ]);
  });

  it('keeps fonts closed for a theme that names no bundled face', () => {
    const { html } = compile(
      page(
        'System only.',
        `preset: system-team
  extends: blueprint
  tokens:
    font-heading: ui-sans-serif, sans-serif
    font-body: ui-sans-serif, sans-serif`,
      ),
    );
    expect(html).not.toContain('@font-face');
    expect(html).not.toContain('font-src data:');
  });

  it('carries the bundled files unmodified', () => {
    for (const font of EMBEDDED_FONTS) {
      const dir = font.family.slice(3).toLowerCase().replaceAll(' ', '-');
      expect(font.latin).toBe(readFileSync(`${fontsDir}/${dir}/latin.woff2`).toString('base64'));
      expect(readFileSync(`${fontsDir}/${dir}/OFL.txt`, 'utf8')).toContain(
        'SIL Open Font License, Version 1.1',
      );
    }
  });

  it('checks every source of a face, not only the first', () => {
    const result = compile(page('An English page.'));
    const csp = /Content-Security-Policy" content="([^"]+)"/u.exec(result.html)?.[1] ?? '';
    const sourceProblem = (css: string): boolean =>
      verifyDocument({
        html: result.html,
        ir: result.ir,
        csp: csp.replaceAll('&#39;', "'"),
        styleNonce: '',
        scriptNonce: '',
        features: new Set(result.features),
        css,
        js: '',
      }).some((diagnostic) => diagnostic.message.includes('non-embedded source'));
    const embedded = 'url(data:font/woff2;base64,AAAA) format("woff2")';
    expect(sourceProblem(`@font-face{font-family:"A";src:${embedded}}`)).toBe(false);
    expect(
      sourceProblem(
        `@font-face{font-family:"A";src:${embedded},url(https://fonts.example/a.woff2)}`,
      ),
    ).toBe(true);
    expect(sourceProblem(`@font-face{font-family:"A";src:${embedded},local("Arial")}`)).toBe(true);
    expect(
      sourceProblem(`@font-face{font-family:"A";src:url("https://fonts.example/a.woff2")}`),
    ).toBe(true);
  });
});
