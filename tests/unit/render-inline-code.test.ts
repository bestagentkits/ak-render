import { describe, expect, it } from 'vitest';
import { compile } from '../../src/index.js';
import { escapeInlineText } from '../../src/render/escape.js';

describe('inline code in prose text', () => {
  it('wraps a backtick pair in <code>', () => {
    expect(escapeInlineText('Run `ak-render catalog` first.')).toBe(
      'Run <code>ak-render catalog</code> first.',
    );
  });

  it('pairs several spans left to right', () => {
    expect(escapeInlineText('`a` and `b`')).toBe('<code>a</code> and <code>b</code>');
  });

  it('keeps an unpaired backtick literal', () => {
    expect(escapeInlineText('a `b')).toBe('a `b');
    expect(escapeInlineText('`a` then `b')).toBe('<code>a</code> then `b');
  });

  it('keeps an empty or whitespace-only pair literal', () => {
    expect(escapeInlineText('a `` b')).toBe('a `` b');
    expect(escapeInlineText('a ` ` b')).toBe('a ` ` b');
  });

  it('does not let a span cross a line break', () => {
    expect(escapeInlineText('a `b\nc` d')).toBe('a `b\nc` d');
  });

  it('escapes markup inside and outside a span, so a span opens no HTML', () => {
    expect(escapeInlineText('`<script>alert(1)</script>`')).toBe(
      '<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>',
    );
    expect(escapeInlineText('<b>x</b> `a & b`')).toBe(
      '&lt;b&gt;x&lt;/b&gt; <code>a &amp; b</code>',
    );
    expect(escapeInlineText('`</code><img src=x onerror=alert(1)>`')).toBe(
      '<code>&lt;/code&gt;&lt;img src=x onerror=alert(1)&gt;</code>',
    );
  });

  it('leaves text without backticks exactly as escapeText would', () => {
    expect(escapeInlineText('plain <text> & more')).toBe('plain &lt;text&gt; &amp; more');
  });

  it('stays linear on a long run with an unclosed backtick', () => {
    const value = `\`${'a'.repeat(50_000)}`;
    const started = performance.now();
    expect(escapeInlineText(value)).toBe(value);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('strong emphasis in prose text', () => {
  it('wraps a double-asterisk pair in <strong>', () => {
    expect(escapeInlineText('Only for **AgentKit customers**.')).toBe(
      'Only for <strong>AgentKit customers</strong>.',
    );
    expect(escapeInlineText('**a** and **b**')).toBe('<strong>a</strong> and <strong>b</strong>');
  });

  it('combines with code spans and keeps asterisks inside a span literal', () => {
    expect(escapeInlineText('**Add** `https://x.test/mcp` now')).toBe(
      '<strong>Add</strong> <code>https://x.test/mcp</code> now',
    );
    expect(escapeInlineText('`a ** b ** c`')).toBe('<code>a ** b ** c</code>');
  });

  it('wraps a pair that holds code spans, at either end or inside', () => {
    expect(escapeInlineText('**All code goes in `domains/Order`.** Rest')).toBe(
      '<strong>All code goes in <code>domains/Order</code>.</strong> Rest',
    );
    expect(escapeInlineText('**`OrderLine`** and **`a` or `b`**')).toBe(
      '<strong><code>OrderLine</code></strong> and <strong><code>a</code> or <code>b</code></strong>',
    );
  });

  it('never pairs a marker inside a code span with one outside it', () => {
    expect(escapeInlineText('**a `b** c`')).toBe('**a <code>b** c</code>');
    expect(escapeInlineText('`a **` b**')).toBe('<code>a **</code> b**');
  });

  it('keeps unpaired, empty, spaced and multi-line markers literal', () => {
    expect(escapeInlineText('a **b')).toBe('a **b');
    expect(escapeInlineText('a **** b')).toBe('a **** b');
    expect(escapeInlineText('2 ** 8 ** 2')).toBe('2 ** 8 ** 2');
    expect(escapeInlineText('** a **')).toBe('** a **');
    expect(escapeInlineText('**a\nb**')).toBe('**a\nb**');
  });

  it('escapes markup inside a strong pair', () => {
    expect(escapeInlineText('**<img src=x onerror=alert(1)>**')).toBe(
      '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>',
    );
  });

  it('stays linear on a long run of unclosed markers', () => {
    const value = `**${'a'.repeat(25_000)} ${'** '.repeat(10_000)}`;
    const started = performance.now();
    escapeInlineText(value);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('stays linear on many strong pairs that hold code spans', () => {
    const value = '**`a` b** '.repeat(20_000);
    const started = performance.now();
    escapeInlineText(value);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('inline code in compiled pages', () => {
  const page = (blocks: string): string =>
    `version: 1\nmeta:\n  title: Inline code\nblocks:\n${blocks}`;

  it('renders backtick spans in text, steps and list items', () => {
    const { html } = compile(
      page(`  - type: text
    text: Run \`ak-render catalog\` to list blocks.
  - type: steps
    items:
      - title: Validate
        text: Run \`ak-render validate page.yaml\`.
  - type: list
    items:
      - text: Use \`describe\` for one block.
`),
    );
    expect(html).toContain('Run <code>ak-render catalog</code> to list blocks.');
    expect(html).toContain('Run <code>ak-render validate page.yaml</code>.');
    expect(html).toContain('Use <code>describe</code> for one block.');
  });

  it('keeps an injected tag inert inside a span', () => {
    const { html } = compile(
      page(`  - type: callout
    title: Careful
    text: Never write \`<script>alert(1)</script>\` here.
`),
    );
    expect(html).toContain('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('leaves titles, the document title and code blocks literal', () => {
    const { html } = compile(
      page(`  - type: callout
    title: The \`ak\` CLI
    text: Body.
  - type: code
    language: bash
    text: echo \`date\`
`).replace('title: Inline code', 'title: About `ak`'),
    );
    expect(html).toContain('<title>About `ak`</title>');
    expect(html).toContain('<strong>The `ak` CLI</strong>');
    expect(html).toContain('echo `date`');
    expect(html).not.toContain('<code>ak</code>');
    expect(html).not.toContain('<code>date</code>');
  });

  it('is deterministic', () => {
    const spec = page('  - type: text\n    text: A `b` c `d` e.\n');
    expect(compile(spec).html).toBe(compile(spec).html);
  });
});
