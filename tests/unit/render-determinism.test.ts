import { describe, expect, it } from 'vitest';
import { compile, render } from '../../src/render/render.js';
import { parseSpec } from '../../src/spec/parse.js';

const SPEC = `version: 1
meta:
  title: Determinism fixture
  description: Same input, same bytes
theme:
  preset: blueprint
state:
  mode: basic
blocks:
  - type: hero
    eyebrow: Determinism
    title: Same input, same bytes
    description: The compiler must not introduce variation.
  - type: stats
    items:
      - label: Runs
        value: '2'
      - label: Differences
        value: '0'
  - type: chart
    kind: bar
    title: Token usage
    labels: [Legacy, AK Render]
    series:
      - label: Tokens
        values: [22000, 6500]
  - type: carousel
    ariaLabel: Slides
    items:
      - title: One
        text: First
      - title: Two
        text: Second
`;

describe('deterministic output', () => {
  it('produces byte-identical HTML and the same hash across runs', () => {
    const first = compile(SPEC);
    const second = compile(SPEC);
    expect(first.html).toBe(second.html);
    expect(first.hash).toBe(second.hash);
    expect(first.bytes).toBe(second.bytes);
  });

  it('produces identical output from JSON and YAML input', () => {
    const fromYaml = compile(SPEC);
    const fromJson = compile(JSON.stringify(parseSpec(SPEC)));
    expect(fromJson.html).toBe(fromYaml.html);
  });

  it('produces identical output when object keys are reordered', () => {
    const document = parseSpec(SPEC) as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(document).reverse()) reordered[key] = document[key];
    expect(compile(reordered).html).toBe(compile(document).html);
  });

  it('emits no timestamp or date-stamped identifier', () => {
    const { html } = compile(SPEC);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
    expect(html).not.toMatch(/generated at/iu);
    expect(html).not.toMatch(/Math\.random/u);
    expect(html).not.toMatch(/Date\.now/u);
  });

  it('changes the hash when the content changes', () => {
    const changed = compile(SPEC.replace('Same input, same bytes', 'Different'));
    expect(changed.hash).not.toBe(compile(SPEC).hash);
  });

  it('keeps emitted attribute order stable across runs', () => {
    const attributesOf = (html: string): string[][] =>
      [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s+[^>]*?)?)>/gu)]
        .slice(0, 400)
        .map((match) =>
          [...(match[2] ?? '').matchAll(/\s([a-z-]+)(?:=|\s|$)/gu)].map((name) => name[1] ?? ''),
        );
    const first = attributesOf(compile(SPEC).html);
    const second = attributesOf(compile(SPEC).html);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(5);
  });

  it('reports a content hash that is stable and non-empty', () => {
    expect(compile(SPEC).hash).toMatch(/^[a-z0-9]{10,}$/u);
  });

  it('render() returns exactly the html of compile()', () => {
    expect(render(SPEC)).toBe(compile(SPEC).html);
  });
});
