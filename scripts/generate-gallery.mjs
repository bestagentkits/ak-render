#!/usr/bin/env node
/**
 * Fixture gallery.
 *
 * Compiles every fixture and every preset snapshot into a browsable example
 * site under `docs/gallery/`, and builds the index page **with the compiler
 * itself** — the gallery is a Page Spec, not hand-written HTML, so a regression
 * that breaks a block breaks the gallery too.
 *
 * Deterministic: no timestamps and no run-dependent ordering, so `--check` can
 * fail CI when the committed gallery is stale.
 *
 * Usage:
 *   node scripts/generate-gallery.mjs [--check]
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThemePreview } from './gallery-theme-preview.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const checkMode = process.argv.includes('--check');
const pagesDir = join(repoRoot, 'fixtures/pages');
const galleryDir = join(repoRoot, 'docs/gallery');
// The fixtures reference assets relatively, so the gallery has to carry them
// beside the pages it links, or every image in every page is a broken link.
const assetsDir = join(repoRoot, 'fixtures/assets');
const galleryAssetsDir = join(galleryDir, 'assets');

let compile;
let VERSION;
let exportDiagramSvg;
let export3dPosterSvg;
let builtinThemeCatalog;
let themePresetNames;
try {
  ({
    compile,
    exportDiagramSvg,
    export3dPosterSvg,
    VERSION,
    builtinThemeCatalog,
    themePresetNames,
  } = await import(new URL('../dist/index.js', import.meta.url)));
} catch {
  console.error('generate-gallery: dist/ is missing; run "pnpm build" first');
  process.exit(1);
}

const fixtures = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.yaml'))
  .sort();

const written = new Map();

/** Compile one fixture and return the entry the index will link to. */
function buildFixture(fixture) {
  const source = readFileSync(join(pagesDir, fixture), 'utf8');
  const result = compile(source, { source: fixture });
  const slug = fixture.replace(/\.yaml$/u, '');
  written.set(`${slug}.html`, result.html);
  const meta = result.ir.meta;
  return {
    slug,
    file: `${slug}.html`,
    title: typeof meta.title === 'string' ? meta.title : slug,
    description: typeof meta.description === 'string' ? meta.description : '',
    bytes: result.bytes,
    hash: result.hash,
    nodes: result.ir.nodes.length,
    features: result.features,
  };
}

const entries = fixtures.map(buildFixture);

// Diagram showcase: contract 2 drawings need an adapter, which fixtures cannot
// carry. The reference grid adapter (tests/unit/support, never exported) draws
// the golden cases so the gallery shows the viewer, motion and SVG export.
// Its sources use TypeScript import paths ending in .js; map them to .ts.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});
const { GOLDEN_CASES } = await import('../tests/unit/support/diagram-golden.ts');
const { gridDiagramAdapter } = await import('../tests/unit/support/grid-diagram-adapter.ts');
const diagramAdapter = gridDiagramAdapter();
const golden = (name) => GOLDEN_CASES.find((item) => item.name === name).spec;
const diagramShowcase = {
  version: 1,
  meta: {
    title: 'Diagram showcase',
    description:
      'Contract 2 diagrams drawn by the reference adapter: search, focus and trace in the viewer, flowing edges and four more motion recipes under one page governor, and a standalone SVG export.',
  },
  theme: { preset: 'blueprint' },
  blocks: [
    {
      type: 'hero',
      eyebrow: 'Diagrams',
      title: 'Drawings that explain themselves',
      description:
        'Each panel below is a Page Spec diagram drawn through the adapter boundary. Select a node to trace its relationships; motion settles on its own and never plays under reduced motion.',
      align: 'center',
    },
    {
      type: 'diagram-panel',
      id: 'pipeline',
      title: 'Deploy pipeline · edge flow',
      spec: {
        diagram_type: 'architecture',
        components: [
          { id: 'github', label: 'GitHub', description: 'git push · webhook' },
          { id: 'cli', label: 'CLI', description: 'ak deploy' },
          { id: 'api', label: 'API', description: 'REST · tokens' },
          { id: 'agent', label: 'Agent', description: 'MCP · --json' },
          { id: 'control', label: 'Control plane', description: 'queue · policy', status: 'live' },
          { id: 'build', label: 'Build', description: 'buildpacks · OCI' },
          { id: 'cluster', label: 'Kubernetes', description: 'rolling · 3 pods' },
          { id: 'domain', label: 'Domain + SSL', description: 'TLS · edge cache' },
        ],
        connections: [
          { from: 'github', to: 'control' },
          { from: 'cli', to: 'control' },
          { from: 'api', to: 'control' },
          { from: 'agent', to: 'control' },
          { from: 'control', to: 'build', label: 'image' },
          { from: 'control', to: 'cluster', label: 'rollout' },
          { from: 'control', to: 'domain', label: 'route' },
        ],
        boundaries: [
          { id: 'sources', label: 'Sources', components: ['github', 'cli', 'api', 'agent'] },
          { id: 'runtime', label: 'Runtime', components: ['build', 'cluster', 'domain'] },
        ],
      },
      motion: 'edge-flow',
    },
    {
      type: 'diagram-panel',
      id: 'boundaries',
      title: 'Nested boundaries · edge flow',
      spec: golden('nested-boundaries'),
      motion: 'edge-flow',
    },
    {
      type: 'diagram-panel',
      id: 'dataflow',
      title: 'Dataflow stages · edge flow',
      spec: golden('dataflow-stages'),
      motion: 'edge-flow',
    },
    {
      type: 'diagram-panel',
      id: 'diamond',
      title: 'Diamond · edge flow',
      spec: golden('diamond'),
      motion: 'edge-flow',
    },
    {
      type: 'diagram-panel',
      id: 'workflow',
      title: 'Workflow lanes · sequence playback',
      spec: golden('workflow-lanes'),
      motion: 'sequence-playback',
    },
    {
      type: 'diagram-panel',
      id: 'dense',
      title: 'Two-level tree · search, focus and flow',
      spec: golden('two-level-tree'),
      motion: 'edge-flow',
    },
    {
      type: 'cta',
      eyebrow: 'Export',
      title: 'Take the drawing anywhere.',
      text: 'exportDiagramSvg writes one standalone, deterministic SVG with the theme colours baked in and no motion state.',
      actions: [
        { label: 'Open the exported SVG', href: 'diagram-showcase.svg', variant: 'primary' },
        { label: 'Back to the gallery', href: 'index.html' },
      ],
    },
  ],
};
{
  const result = compile(diagramShowcase, { source: 'diagram-showcase', diagramAdapter });
  written.set('diagram-showcase.html', result.html);
  written.set(
    'diagram-showcase.svg',
    exportDiagramSvg(diagramShowcase, { diagramAdapter, blockId: 'pipeline' }),
  );
  entries.push({
    slug: 'diagram-showcase',
    file: 'diagram-showcase.html',
    title: diagramShowcase.meta.title,
    description: diagramShowcase.meta.description,
    bytes: result.bytes,
    hash: result.hash,
    nodes: result.ir.nodes.length,
    features: result.features,
  });
}

// 3D showcase: the most striking fixture per 3D widget plus one stress demo.
// The model fixture references a glTF beside it, so it compiles with a model
// resolver rooted at fixtures/3d; the model is inlined into the page.
const threeDir = join(repoRoot, 'fixtures/3d');
const { createModelResolver } = await import(
  new URL('../dist/assets/model-assets.js', import.meta.url)
);
const modelResolver = createModelResolver(threeDir);
const { createPointCloudResolver } = await import(
  new URL('../dist/assets/point-cloud-assets.js', import.meta.url)
);
// Showcase title and blurb per fixture; the fixtures keep their test titles.
const THREE_D_SHOWCASE = {
  'scene-3d-dense': [
    'Server room',
    'A lit rack field of forty-eight shaped nodes you can orbit, select and read as a list.',
  ],
  'network-3d-basic': [
    'Service mesh',
    'Eighteen services in four tiers; pick one to light up what it calls and what calls it.',
  ],
  'model-3d-crate': [
    'Shipping crate',
    'An inlined glTF crate with animation clips, three finishes and numbered hotspots.',
  ],
  'scatter-3d-basic': [
    'City metrics',
    'Cities plotted on three metrics, with axis labels, groups and a readable data table.',
  ],
  'bars-3d-dense': [
    'Weekly margin by region',
    'A dense field of bars by region and week, with the full table beside it.',
  ],
  'particles-3d-galaxy': [
    'Particle galaxy',
    'Nine thousand seeded stars wind into spiral arms; the same seed always draws the same sky.',
  ],
  'particles-3d-presets': [
    'Particle presets',
    'Nebula, fountain, snow, fireflies, vortex and a custom mix, each from a seed and a few typed fields.',
  ],
  'shader-3d-controls': [
    'Shader reveal',
    'A torus knot burns away along a noise front; preset buttons and sliders drive the closed shader live.',
  ],
  'shader-3d-presets': [
    'Shader presets',
    'Noise, fresnel, hologram, distortion and dissolve, each a closed preset with typed dials and post passes.',
  ],
  'text-3d-hero': [
    'Extruded headline',
    'Bevelled lettering from a bundled OFL font rises letter by letter, then floats; the poster draws the same words.',
  ],
  'text-3d-materials': [
    '3D text finishes',
    'Satin, metal, chrome, glass and neon lettering with wave, spin and float motion by character or word.',
  ],
  'product-3d-speaker': [
    'Studio speaker',
    'A studio-lit speaker in four finishes, with numbered hotspots and an exploded view.',
  ],
  'globe-3d-routes': [
    'Global network',
    'Twenty-four offices on a dotted globe with a night side; scrub the years or pick an office to fly to it.',
  ],
  'globe-3d-stress': [
    'Five hundred sites',
    'Five hundred observation sites and two hundred links, clustered into counts until you zoom in.',
  ],
  'morph-3d-shapes': [
    'Morphing form',
    'One glossy surface springs from a sphere to a rounded cube to a twelve-point star, or to the shape you pick.',
  ],
  'morph-3d-rings': [
    'Ring to knot',
    'A ring ties itself into a trefoil knot, then twists into a square band, all on one wrapped surface.',
  ],
  'point-cloud-3d-depot': [
    'Depot survey scan',
    'Thirty thousand laser returns read from a local scan file, at true proportions; pick a point for its exact coordinates or cut the roofs away.',
  ],
  'timeline-3d-space': [
    'Road to orbit',
    'Twelve spaceflight milestones on a path in space; step, scrub or click and the camera flies to each one.',
  ],
  'timeline-3d-hundred': [
    'A hundred sprints',
    'One hundred milestones coiled into a rising spiral, still in order and one keystroke apart.',
  ],
  'terrain-3d-alpine': [
    'Alpine flyover',
    'A 256 x 256 heightmap of twin peaks and a glacial valley, with contours, an elevation legend and a flyover of four places.',
  ],
  'terrain-3d-crater': [
    'Volcanic caldera',
    'A caldera rim and a young cone in a volcanic colour ramp, with 50 m contours and each place at its elevation.',
  ],
  'network-3d-stress': [
    'A thousand-node graph',
    'A large force-laid graph that shows the network widget holding up at scale.',
  ],
};

const threeEntries = Object.entries(THREE_D_SHOWCASE).map(([name, [title, description]]) => {
  const source = readFileSync(join(threeDir, `${name}.yaml`), 'utf8');
  const result = compile(source, {
    source: `${name}.yaml`,
    modelResolver,
    pointCloudResolver: createPointCloudResolver(threeDir),
  });
  const file = `3d-${name}.html`;
  written.set(file, result.html);
  // A label-free thumbnail of the widget's own poster that follows the
  // reader's colour scheme; tiny text would be unreadable at card size.
  written.set(
    `3d-${name}.svg`,
    export3dPosterSvg(source, {
      modelResolver,
      pointCloudResolver: createPointCloudResolver(threeDir),
      scheme: 'auto',
      labels: false,
    }),
  );
  return {
    slug: `3d-${name}`,
    file,
    poster: `3d-${name}.svg`,
    title,
    description,
    bytes: result.bytes,
  };
});

/** One linked card per artifact, so the gallery is navigable without a script. */
const artifactCard = (entry) => ({
  type: 'card',
  title: entry.title,
  text: entry.description === '' ? entry.file : entry.description,
  blocks: [
    {
      type: 'text',
      variant: 'caption',
      text: `${entry.nodes} nodes · ${(entry.bytes / 1024).toFixed(1)} kB`,
    },
    { type: 'link', label: `Open ${entry.file}`, href: entry.file },
  ],
});

/** A 3D card leads with the widget's static poster, the same plan the page draws first. */
const threeCard = (entry) => ({
  type: 'card',
  title: entry.title,
  text: entry.description,
  blocks: [
    { type: 'image', src: entry.poster, alt: `Static preview of ${entry.title}` },
    { type: 'link', label: `Open ${entry.title}`, href: entry.file },
  ],
});
// One compiled page per built-in preset, plus the dropdown viewer over them.
for (const [file, html] of buildThemePreview({
  compile,
  builtinThemeCatalog,
  themePresetNames,
  pagesDir,
  version: VERSION,
})) {
  written.set(file, html);
}

/** The index is itself a Page Spec: the gallery dogfoods the compiler. */
const indexSpec = {
  version: 1,
  meta: {
    title: 'AK Render fixture gallery',
    description: `Every fixture compiled by @bestagentkits/render@${VERSION}. Each page is a standalone artifact that opens from disk with no network.`,
  },
  theme: { preset: 'blueprint' },
  blocks: [
    {
      type: 'hero',
      eyebrow: `@bestagentkits/render@${VERSION}`,
      title: 'Fixture gallery',
      description:
        'Each artifact below was compiled from a Page Spec in fixtures/pages and opens directly from disk with zero external requests.',
      align: 'center',
      actions: [
        { label: 'See the 3D widgets', href: '#ak-sec-widgets-3d', variant: 'primary' },
        { label: 'Preview every theme', href: 'themes/index.html' },
      ],
      src: 'assets/shot-components.webp',
      alt: 'The all-components fixture in the swiss-clean theme, opening on its hero and layout section',
      address: 'all-components.html',
    },
    {
      type: 'marquee',
      label: 'Fixtures in this gallery',
      items: entries
        .filter((entry) => entry.slug !== 'diagram-showcase')
        .map((entry) => entry.title),
    },
    {
      type: 'showcase',
      eyebrow: 'Start here',
      title: 'The showcase page',
      text: 'One Page Spec using the showcase blocks: a bento mosaic, KPI sparklines, a typing terminal, a file tree, a before/after slider, and a screen recording of this gallery.',
      bullets: [
        'Every image is a screenshot of a compiled fixture',
        'Every number is measured from the repository',
      ],
      src: 'assets/shot-showcase.webp',
      alt: 'The showcase fixture: hero title, marquee, and a framed explain screenshot',
      address: 'showcase.html',
    },
    {
      type: 'stats',
      items: [
        { label: 'Fixtures', value: String(entries.length) },
        { label: '3D demos', value: String(threeEntries.length) },
        { label: 'Compiler', value: VERSION },
        { label: 'Network', value: 'denied' },
      ],
    },
    {
      type: 'section',
      id: 'widgets-3d',
      title: '3D widgets',
      blocks: [
        {
          type: 'text',
          text: 'Scenes, networks, models, scatter plots, point clouds, bar fields and particle effects rendered with WebGL from a Page Spec. Each one keeps a readable summary for print, screenshots and no-JS readers.',
        },
        { type: 'grid', columns: 3, blocks: threeEntries.map(threeCard) },
      ],
    },
    // One card per artifact: what it is, what it costs, and a link to open it,
    // so the gallery is navigable without a script.
    {
      type: 'section',
      title: 'Open an artifact',
      blocks: [
        {
          type: 'grid',
          columns: 3,
          blocks: entries.map(artifactCard),
        },
      ],
    },
    {
      type: 'list',
      title: 'What each artifact proves',
      items: [
        {
          text: 'The catalog covers layout, content, information, collections, charts, diagrams, and media.',
        },
        { text: 'Every artifact is deterministic: the same spec yields the same bytes and hash.' },
        {
          text: 'Every artifact opens over file:// with no CDN, no font fetch, and no remote image.',
        },
        { text: 'Interactions are declarative: no page-authored script and no inline handler.' },
      ],
    },
    {
      type: 'cta',
      eyebrow: 'Keep going',
      title: 'Every block, on one page.',
      text: 'The all-components fixture renders the whole v1 roster in one artifact, and the showcase puts the presentation blocks to work.',
      actions: [
        { label: 'Open all components', href: 'all-components.html', variant: 'primary' },
        { label: 'Open the showcase', href: 'showcase.html' },
        { label: 'Preview every theme', href: 'themes/index.html' },
      ],
    },
  ],
};

const index = compile(indexSpec, { source: 'gallery-index' });
written.set('index.html', index.html);

const expected = new Map(written);

if (checkMode) {
  const problems = [];
  for (const [file, html] of expected) {
    const path = join(galleryDir, file);
    if (!existsSync(path)) {
      problems.push(`missing ${relative(repoRoot, path)}`);
      continue;
    }
    if (readFileSync(path, 'utf8') !== html) problems.push(`stale ${relative(repoRoot, path)}`);
  }
  const onDisk = ['', 'themes/'].flatMap((dir) =>
    existsSync(join(galleryDir, dir))
      ? readdirSync(join(galleryDir, dir))
          .filter((name) => name.endsWith('.html'))
          .map((name) => `${dir}${name}`)
      : [],
  );
  for (const name of onDisk) {
    if (!expected.has(name)) problems.push(`unexpected docs/gallery/${name}`);
  }
  for (const name of readdirSync(assetsDir)) {
    const source = join(assetsDir, name);
    const target = join(galleryAssetsDir, name);
    if (!existsSync(target)) {
      problems.push(`missing ${relative(repoRoot, target)}`);
      continue;
    }
    if (readFileSync(source).compare(readFileSync(target)) !== 0) {
      problems.push(`stale ${relative(repoRoot, target)}`);
    }
  }
  if (problems.length > 0) {
    console.error('generate-gallery: the committed gallery is out of date:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Run "pnpm gallery:generate".');
    process.exit(1);
  }
  console.log(`generate-gallery: ${expected.size} gallery pages are up to date`);
} else {
  rmSync(galleryDir, { recursive: true, force: true });
  mkdirSync(join(galleryDir, 'themes'), { recursive: true });
  for (const [file, html] of expected) {
    writeFileSync(join(galleryDir, file), html, 'utf8');
  }
  cpSync(assetsDir, galleryAssetsDir, { recursive: true });
  console.log(`generate-gallery: wrote ${expected.size} pages to docs/gallery/`);
  for (const entry of entries) {
    console.log(`  ${entry.file}: ${entry.bytes} bytes, ${entry.nodes} nodes`);
  }
  for (const entry of threeEntries) console.log(`  ${entry.file}: ${entry.bytes} bytes`);
  console.log(`  index.html: ${index.bytes} bytes`);
}
