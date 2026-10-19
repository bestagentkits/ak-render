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
    const named = LANGUAGE_DESCRIPTION.replace(
      /^Highlighted at compile time: |\. Any.*$/gu,
      '',
    ).split(', ');
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

  it('highlights TypeScript type words that JavaScript leaves plain', () => {
    expect(tokens(codeLines('let n: number = 1;', 'ts'))).toContainEqual(['k', 'number']);
    expect(tokens(codeLines('let number = 1;', 'js'))).not.toContainEqual(['k', 'number']);
  });

  it('highlights HTML tags, attributes, entities and embedded script and style', () => {
    const html = codeLines(
      [
        '<!doctype html>',
        '<!-- note -->',
        '<a href="/x?a=1&amp;b=2" hidden>Go &amp; see</a>',
        '<style>.card { color: #fff; }</style>',
        "<script>const a = 'x';</script>",
      ].join('\n'),
      'html',
    );
    expect(tokens(html)).toEqual([
      ['meta', '&lt;!doctype html&gt;'],
      ['c', '&lt;!-- note --&gt;'],
      ['k', 'a'],
      ['a', 'href'],
      ['s', '"/x?a=1&amp;amp;b=2"'],
      ['a', 'hidden'],
      ['n', '&amp;amp;'],
      ['k', 'a'],
      ['k', 'style'],
      ['f', '.card'],
      ['a', 'color'],
      ['n', '#fff'],
      ['k', 'style'],
      ['k', 'script'],
      ['k', 'const'],
      ['s', "'x'"],
      ['k', 'script'],
    ]);
    const shifted = codeLines(`<p>${'İ'.repeat(30)}</p><script>go()</script><b>import</b>`, 'html');
    expect(tokens(shifted).slice(-5)).toEqual([
      ['k', 'script'],
      ['f', 'go'],
      ['k', 'script'],
      ['k', 'b'],
      ['k', 'b'],
    ]);
    expect(isHighlighted('xml')).toBe(true);
    expect(isHighlighted('svg')).toBe(true);
  });

  it('highlights CSS selectors, at-rules, properties, values and comments', () => {
    const html = codeLines(
      '@media (min-width: 40rem) {\n  .a, #b > p { margin: 0 auto !important; width: calc(100% - 2px); }\n}\n/* end */',
      'css',
    );
    expect(tokens(html)).toEqual([
      ['k', '@media'],
      ['a', 'min-width'],
      ['n', '40rem'],
      ['f', '.a'],
      ['f', '#b'],
      ['k', 'p'],
      ['a', 'margin'],
      ['n', '0'],
      ['k', '!important'],
      ['a', 'width'],
      ['f', 'calc'],
      ['n', '100%'],
      ['n', '2px'],
      ['c', '/* end */'],
    ]);
  });

  it('highlights Markdown headings, fences, quotes, list markers and inline code', () => {
    const html = codeLines(
      [
        '# Title',
        '> quoted',
        '- item with `code` and **bold** [link](https://x.dev)',
        '```js',
        'let a = 1;',
        '```',
      ].join('\n'),
      'md',
    );
    expect(tokens(html)).toEqual([
      ['k', '# Title'],
      ['c', '&gt; quoted'],
      ['a', '-'],
      ['s', '`code`'],
      ['k', '**bold**'],
      ['s', 'https://x.dev'],
      ['meta', '```js'],
      ['s', 'let a = 1;'],
      ['meta', '```'],
    ]);
  });

  it('closes a Markdown fence only with a bare run at least as long', () => {
    const html = codeLines(['````md', '```js', '````', 'after'].join('\n'), 'markdown');
    expect(tokens(html)).toEqual([
      ['meta', '````md'],
      ['s', '```js'],
      ['meta', '````'],
    ]);
  });

  it('treats Object.prototype names as unknown languages', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isHighlighted(name)).toBe(false);
      expect(codeLines('a <b>', name)).toBe('<span class="ak-line">a &lt;b&gt;</span>');
    }
  });

  it('keeps every new scanner text-faithful', () => {
    const sources: [string, string][] = [
      ["<p class=x data-a='1'>a &lt; b</p>\n<br/>", 'html'],
      ['a { b: c }\n"unterminated', 'css'],
      ['## h\n\n* `x` **y**', 'markdown'],
      ['<script>"\n</script>', 'html'],
    ];
    for (const [source, language] of sources) {
      const text = codeLines(source, language)
        .replace(/<[^>]+>/gu, '')
        .replace(/&quot;/gu, '"')
        .replace(/&#39;/gu, "'")
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&amp;/gu, '&');
      expect(text).toBe(source);
    }
  });

  it('stays linear on lines full of unclosed openers', () => {
    const inputs: [string, string][] = [
      ['${'.repeat(50_000), 'bash'],
      ['#['.repeat(50_000), 'rust'],
      ['<a "'.repeat(25_000), 'html'],
      ['<!--'.repeat(25_000), 'html'],
      ['](](('.repeat(20_000), 'markdown'],
      ['`**'.repeat(33_000), 'markdown'],
      ['/*@#{'.repeat(20_000), 'css'],
    ];
    for (const [value, language] of inputs) {
      const started = performance.now();
      codeLines(value, language);
      expect(performance.now() - started, language).toBeLessThan(1_000);
    }
  });

  it('stays linear on long unclosed input', () => {
    const value = `${'#[ ${ "a '.repeat(20_000)}\n${'x '.repeat(50_000)}`;
    const started = performance.now();
    codeLines(value, 'php');
    codeLines(value, 'bash');
    codeLines(value, 'yaml');
    expect(performance.now() - started).toBeLessThan(5_000);
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
