import { describe, expect, it } from 'vitest';
import { compile } from '../../src/index.js';
import { LANGUAGE_DESCRIPTION } from '../../src/registry/define-helpers.js';
import { codeLines, isHighlighted } from '../../src/render/syntax-highlight.js';

const tokens = (html: string): [string, string][] =>
  [...html.matchAll(/<span class="ak-tk-(\w+)">([^<]*)<\/span>/gu)].map(
    (match): [string, string] => [match[1] ?? '', match[2] ?? ''],
  );

describe('syntax highlighting', () => {
  it('leaves an unknown language as plain numbered lines', () => {
    expect(codeLines('a <b>\nc\n', 'text')).toBe(
      '<span class="ak-line">a &lt;b&gt;</span>\n<span class="ak-line">c</span>',
    );
    expect(isHighlighted('text')).toBe(false);
    expect(isHighlighted('brainfuck')).toBe(false);
  });

  it('highlights PHP keywords, types, variables, attributes, strings and comments', () => {
    const html = codeLines(
      [
        '#[IsPublic]',
        'interface OrderDomain',
        '{',
        '    // Places one order.',
        "    public function place(OrderRequest $request, string $note = 'x'): ?Order;",
        '}',
        'new PricedOrderLine(quantity: 3, unit: self::UNIT, ok: true);',
      ].join('\n'),
      'php',
    );
    expect(tokens(html)).toEqual([
      ['a', '#[IsPublic]'],
      ['k', 'interface'],
      ['t', 'OrderDomain'],
      ['c', '// Places one order.'],
      ['k', 'public'],
      ['k', 'function'],
      ['f', 'place'],
      ['t', 'OrderRequest'],
      ['v', '$request'],
      ['k', 'string'],
      ['v', '$note'],
      ['s', "'x'"],
      ['t', 'Order'],
      ['k', 'new'],
      ['t', 'PricedOrderLine'],
      ['n', '3'],
      ['k', 'self'],
      ['n', 'UNIT'],
      ['n', 'true'],
    ]);
  });

  it('highlights every language the prop description names', () => {
    const named = LANGUAGE_DESCRIPTION.replace(/^Highlighted: |\. Any.*$/gu, '').split(', ');
    expect(named.filter((language) => !isHighlighted(language))).toEqual([]);
  });

  it('resolves aliases case-insensitively', () => {
    expect(isHighlighted('TS')).toBe(true);
    expect(isHighlighted('yml')).toBe(true);
    expect(isHighlighted('sh')).toBe(true);
    expect(tokens(codeLines('const a = 1;', 'TypeScript'))).toEqual([
      ['k', 'const'],
      ['n', '1'],
    ]);
  });

  it('closes and reopens a token that spans lines, so each line is balanced', () => {
    const html = codeLines('/* one\ntwo */ x', 'javascript');
    expect(html).toBe(
      '<span class="ak-line"><span class="ak-tk-c">/* one</span></span>\n' +
        '<span class="ak-line"><span class="ak-tk-c">two */</span> x</span>',
    );
  });

  it('marks JSON and YAML keys apart from values', () => {
    expect(tokens(codeLines('{"id": "a", "n": 2, "ok": null}', 'json'))).toEqual([
      ['t', '"id"'],
      ['s', '"a"'],
      ['t', '"n"'],
      ['n', '2'],
      ['t', '"ok"'],
      ['n', 'null'],
    ]);
    expect(tokens(codeLines('url: http://x.test # note\n- runs-on: true', 'yaml'))).toEqual([
      ['t', 'url'],
      ['c', '# note'],
      ['t', 'runs-on'],
      ['n', 'true'],
    ]);
  });

  it('colors diff lines by their prefix', () => {
    expect(tokens(codeLines('--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same', 'diff'))).toEqual([
      ['meta', '--- a'],
      ['meta', '+++ b'],
      ['hunk', '@@ -1 +1 @@'],
      ['del', '-old'],
      ['ins', '+new'],
    ]);
  });

  it('escapes markup inside every token', () => {
    const html = codeLines('"<script>" // </span><b>', 'javascript');
    expect(html).toContain('<span class="ak-tk-s">"&lt;script&gt;"</span>');
    expect(html).toContain('<span class="ak-tk-c">// &lt;/span&gt;&lt;b&gt;</span>');
  });

  it('keeps the text content unchanged', () => {
    const source = 'def f(x):\n    return f"{x}"  # done\n';
    const text = codeLines(source, 'python')
      .replace(/<[^>]+>/gu, '')
      .replace(/&quot;/gu, '"');
    expect(text).toBe(source.replace(/\n$/u, ''));
  });

  it('stays linear on long unclosed input', () => {
    const value = `${'#[ ${ "a '.repeat(20_000)}\n${'x '.repeat(50_000)}`;
    const started = performance.now();
    codeLines(value, 'php');
    codeLines(value, 'bash');
    codeLines(value, 'yaml');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('syntax highlighting in compiled pages', () => {
  const page = (blocks: string): string => `version: 1\nmeta:\n  title: Code\nblocks:\n${blocks}`;

  it('emits the syntax sheet only when a block is highlighted', () => {
    const plain = compile(page('  - type: code\n    text: echo 1\n'));
    expect(plain.features).not.toContain('syntax');
    expect(plain.html).not.toContain('.ak-tk-');

    const php = compile(page('  - type: code\n    language: php\n    text: echo $a;\n'));
    expect(php.features).toContain('syntax');
    expect(php.html).toContain('.ak-tk-k{');
    expect(php.html).toContain('<span class="ak-tk-v">$a</span>');
  });

  it('highlights api-endpoint bodies, which default to JSON', () => {
    const { html, features } = compile(
      page(`  - type: api-endpoint
    method: POST
    path: /orders
    request:
      code: '{"id": 1}'
`),
    );
    expect(features).toContain('syntax');
    expect(html).toContain('<span class="ak-tk-t">"id"</span>');
  });
});
