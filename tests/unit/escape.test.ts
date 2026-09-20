import { describe, expect, it } from 'vitest';
import {
  escapeAttribute,
  escapeText,
  escapeUrl,
  renderAttributes,
  serializeJsonForScript,
} from '../../src/render/escape.js';

describe('escaping', () => {
  it('escapes text content for an element body', () => {
    expect(escapeText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeText('a & b')).toBe('a &amp; b');
    expect(escapeText('plain')).toBe('plain');
  });

  it('escapes attribute values, including the quote that would end the attribute', () => {
    expect(escapeAttribute('a" onmouseover="alert(1)')).toBe(
      'a&quot; onmouseover&#61;&quot;alert(1)',
    );
    expect(escapeAttribute("it's")).toBe('it&#39;s');
    expect(escapeAttribute('back`tick=')).toBe('back&#96;tick&#61;');
    expect(escapeAttribute('line\nbreak')).toBe('line&#10;break');
  });

  it('strips control characters that could break a parser', () => {
    expect(escapeAttribute('a\u0000b\u0007c')).toBe('abc');
  });

  it('percent-encodes characters that are unsafe inside a URL reference', () => {
    expect(escapeUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(escapeUrl('a"b<c>d')).toBe('a%22b%3Cc%3Ed');
    expect(escapeUrl('safe/path/x.svg')).toBe('safe/path/x.svg');
  });

  it('serializes embedded JSON so it cannot close the containing script element', () => {
    const payload = { text: '</script><script>alert(1)</script>', amp: 'a&b' };
    const serialized = serializeJsonForScript(payload);
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).toContain('\\u003c');
    expect(serialized).toContain('\\u0026');
  });

  it('escapes the Unicode line separators that terminate a JavaScript line', () => {
    const serialized = serializeJsonForScript({ text: 'a\u2028b\u2029c' });
    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
    expect(serialized).not.toContain('\u2028');
  });

  it('serializes null for undefined input instead of emitting the token undefined', () => {
    expect(serializeJsonForScript(undefined)).toBe('null');
  });

  it('renders attributes in a fixed, sorted order regardless of insertion order', () => {
    const forward = renderAttributes({ zeta: '1', alpha: '2', middle: '3' });
    const reversed = renderAttributes({ middle: '3', alpha: '2', zeta: '1' });
    expect(forward).toBe(' alpha="2" middle="3" zeta="1"');
    expect(reversed).toBe(forward);
  });

  it('omits absent, null, and false attributes and renders true as a bare attribute', () => {
    const rendered = renderAttributes({ missing: undefined, nothing: null, off: false, on: true });
    expect(rendered).toBe(' on');
  });
});
