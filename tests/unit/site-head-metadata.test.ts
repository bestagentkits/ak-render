import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build script without type declarations
import { addSiteHeadMetadata } from '../../scripts/site-head-metadata.mjs';
import { compile } from '../../src/index.js';

const META = {
  title: 'AK Render · test',
  description: 'Compiles a "spec" </script> into HTML.',
  version: '9.9.9',
};

function landing(): string {
  return compile({
    version: 1,
    meta: { title: META.title, description: META.description },
    blocks: [{ type: 'hero', title: 'Hello' }],
  }).html;
}

describe('site head metadata', () => {
  it('turns the compiled card into a website card with an absolute image', () => {
    const html = addSiteHeadMetadata(landing(), META);
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).not.toContain('content="article"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://render.agentkit.best/og-card.png" />',
    );
    expect(html).toContain('<link rel="canonical" href="https://render.agentkit.best/" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
  });

  it('lets the content security policy load the manifest', () => {
    expect(addSiteHeadMetadata(landing(), META)).toContain('manifest-src &#39;self&#39;;');
  });

  it('keeps JSON-LD parseable and unable to close its script element', () => {
    const html = addSiteHeadMetadata(landing(), META);
    const json = html.split('<script type="application/ld+json">')[1]?.split('</script>')[0] ?? '';
    expect(json).not.toContain('<');
    const graph = JSON.parse(json)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.map((node) => node['@type'])).toEqual([
      'Organization',
      'WebSite',
      'SoftwareApplication',
    ]);
    expect(graph[2]?.softwareVersion).toBe('9.9.9');
    expect(graph[2]?.description).toBe(META.description);
  });

  it('is deterministic', () => {
    const page = landing();
    expect(addSiteHeadMetadata(page, META)).toBe(addSiteHeadMetadata(page, META));
  });

  it('fails when the compiled head no longer has an anchor', () => {
    const html = landing().replace('<meta property="og:type" content="article" />', '');
    expect(() => addSiteHeadMetadata(html, META)).toThrow(/og:type/);
  });
});
