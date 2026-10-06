import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { buildRuntime } from '../../src/render/runtime.js';

describe('runtime state', () => {
  it('escapes state so a value cannot close the script element', () => {
    const js = buildRuntime({
      features: new Set(['theme']),
      state: { note: '</script><b>x</b>', line: '\u2028' },
      hasBindings: false,
    });
    expect(js).not.toContain('</script>');
    expect(js).toContain('\\u003c/script\\u003e');
    expect(js).toContain('\\u2028');
  });

  it('keeps an author state value inert in the emitted page', () => {
    const html = compile({
      version: 1,
      meta: { title: 'Escape' },
      state: { view: '</script><b>x' },
      blocks: [{ type: 'text', text: 'a', visibleWhen: { path: 'state.view', truthy: true } }],
    }).html;
    expect(html.match(/<\/script>/gu)?.length).toBe(1);
  });

  it('stops event propagation at the nearest block', () => {
    const js = buildRuntime({ features: new Set(), state: {}, hasBindings: true });
    expect(js).toContain("if (target.hasAttribute('data-ak-id')) return;");
  });
});
