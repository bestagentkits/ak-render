import { describe, expect, it } from 'vitest';
import type { DiagramRenderResult } from '../../src/diagram/adapter-manifest.js';
import { exportDiagramSvg } from '../../src/diagram/diagram-export.js';
import { isRenderError } from '../../src/errors.js';
import {
  applyProposal,
  inspectBlock,
  readSource,
  studioState,
} from '../../src/motion/studio/studio-model.js';
import { compile } from '../../src/render/render.js';
import { GOLDEN_CASES, goldenPage } from './support/diagram-golden.js';
import { gridDiagramAdapter } from './support/grid-diagram-adapter.js';

const adapter = gridDiagramAdapter();
const nested = GOLDEN_CASES.find((golden) => golden.name === 'nested-boundaries');
if (nested === undefined) throw new Error('missing golden case');

describe('static diagram SVG export', () => {
  const svg = exportDiagramSvg(goldenPage(nested, { motion: 'edge-trace' }), {
    diagramAdapter: adapter,
  });

  it('is one standalone, offline SVG with the spec hooks and no page residue', () => {
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.match(/<svg /gu)).toHaveLength(1);
    expect(svg).not.toMatch(/nonce=|@scope|<script|https?:\/\/(?!www\.w3\.org)/u);
    expect(svg.match(/ data-ak-node="/gu)).toHaveLength(nested.nodes.length);
    expect(svg.match(/ data-ak-edge="/gu)).toHaveLength(nested.edges.length);
  });

  it('carries no motion state, whatever recipe the panel has', () => {
    expect(svg).not.toMatch(/data-ak-dm-|data-ak-dv-|pathLength/u);
  });

  it('writes the theme colours so it reads outside the page, light or dark', () => {
    expect(svg).toMatch(/style="--ak-color-[^"]*color:#[0-9a-f]+;background:#[0-9a-f]+"/u);
    const dark = exportDiagramSvg(goldenPage(nested), { diagramAdapter: adapter, scheme: 'dark' });
    expect(dark).not.toBe(exportDiagramSvg(goldenPage(nested), { diagramAdapter: adapter }));
  });

  it('is deterministic', () => {
    expect(
      exportDiagramSvg(goldenPage(nested, { motion: 'edge-trace' }), { diagramAdapter: adapter }),
    ).toBe(svg);
  });

  it('keeps a nested viewport whole and always declares the SVG namespace', () => {
    const nestedAdapter = {
      ...adapter,
      render: (input: Parameters<typeof adapter.render>[0]) => {
        const out = adapter.render(input) as DiagramRenderResult;
        const svg = out.svg
          .replace(' xmlns="http://www.w3.org/2000/svg"', '')
          .replace('</defs>', '</defs><svg x="0" y="0" width="4" height="4"><circle r="2"/></svg>');
        return { ...out, svg };
      },
    };
    const out = exportDiagramSvg(goldenPage(nested), { diagramAdapter: nestedAdapter });
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out.match(/<svg[\s>]/gu)).toHaveLength(2);
    expect(out.match(/<\/svg>/gu)).toHaveLength(2);
    expect(out.match(/ data-ak-node="/gu)).toHaveLength(nested.nodes.length);
  });

  it('refuses a page or block with no contract 2 drawing', () => {
    for (const run of [
      () => exportDiagramSvg(goldenPage(nested)),
      () => exportDiagramSvg(goldenPage(nested), { diagramAdapter: adapter, blockId: 'missing' }),
    ]) {
      try {
        run();
        expect.unreachable();
      } catch (error) {
        expect(isRenderError(error) && error.code).toBe('SPEC_VALIDATION_ERROR');
      }
    }
  });
});

describe('Motion Studio on a diagram', () => {
  const text = [
    'version: 1',
    'meta:',
    '  title: Studio',
    'blocks:',
    '  - type: diagram-panel',
    '    id: flow',
    '    title: Flow',
    '    spec:',
    '      components:',
    '        - id: a',
    '          label: A',
    '        - id: b',
    '          label: B',
    '      connections:',
    '        - from: a',
    '          to: b',
    '',
  ].join('\n');
  const source = readSource('page.yaml', text);

  it('offers the diagram recipes and inspects the drawing it previews', () => {
    const state = studioState(
      source,
      { blocks: { flow: 'signal-relay' } },
      { diagramAdapter: adapter },
    );
    const block = state.blocks.find((item) => item.id === 'flow');
    expect(block?.compatible).toEqual(
      expect.arrayContaining([
        'edge-trace',
        'signal-relay',
        'node-activation',
        'sequence-playback',
      ]),
    );
    const inspection = inspectBlock(state, state.html ?? '', 'flow');
    expect(inspection.css).toContain('ak-m-relay');
    expect(inspection.layout).toEqual({
      drawn: true,
      nodes: 2,
      relationships: 1,
      groups: 0,
      capabilities: ['focus', 'trace', 'zoom', 'search'],
    });
  });

  it('says when a panel has no drawing for diagram motion to move', () => {
    const state = studioState(source, {}, {});
    expect(inspectBlock(state, compile(text).html, 'flow').layout?.drawn).toBe(false);
  });

  it('writes back only the declarative motion line', () => {
    const after = applyProposal(source, { blocks: { flow: 'edge-trace' } });
    const added = after.split('\n').filter((line) => !text.split('\n').includes(line));
    expect(added).toEqual(['    motion: edge-trace']);
  });
});
