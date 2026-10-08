/**
 * Landing head metadata for render.agentkit.best.
 *
 * The compiled page carries a portable head (title, description, a basic Open
 * Graph card). The hosted landing also needs what only a page with a known
 * public address can state: canonical URL, absolute social image, icons, web
 * manifest and structured data. Those are site concerns, not Page Spec
 * concerns, so the site build adds them here instead of the compiler.
 *
 * Every edit replaces a known anchor in the compiled head. A missing anchor
 * fails the build, so a compiler change cannot silently drop the metadata.
 * Output stays deterministic: no dates, no network.
 */

export const SITE_ORIGIN = 'https://render.agentkit.best';
const REPO_URL = 'https://github.com/bestagentkits/ak-render';
const NPM_URL = 'https://www.npmjs.com/package/@bestagentkits/render';
const AGENTKIT_URL = 'https://agentkit.best';

/** Social card geometry, matching `scripts/generate-site-images.mjs`. */
const CARD = {
  path: '/og-card.png',
  width: 1200,
  height: 630,
  alt: 'AK Render: your agent writes YAML, the compiler ships HTML.',
};

/** Theme colors of the blueprint preset the landing uses (light, dark). */
const THEME_COLOR = { light: '#fffefb', dark: '#111d2e' };

function escapeAttr(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** JSON-LD inside a script element: `<` is escaped so no `</script>` can appear. */
function jsonLd(value) {
  return JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');
}

function structuredData({ title, description, version }) {
  const organization = {
    '@type': 'Organization',
    '@id': `${AGENTKIT_URL}/#organization`,
    name: 'AgentKit',
    url: AGENTKIT_URL,
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: 'AK Render',
        description,
        inLanguage: 'en',
        publisher: { '@id': organization['@id'] },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_ORIGIN}/#software`,
        name: 'AK Render',
        alternateName: '@bestagentkits/render',
        headline: title,
        description,
        url: `${SITE_ORIGIN}/`,
        image: `${SITE_ORIGIN}${CARD.path}`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows (Node.js 20+)',
        softwareVersion: version,
        license: 'https://opensource.org/licenses/MIT',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        codeRepository: REPO_URL,
        downloadUrl: NPM_URL,
        sameAs: [REPO_URL, NPM_URL],
        publisher: { '@id': organization['@id'] },
      },
    ],
  };
}

/** Replaces exactly one occurrence of `anchor`, or throws. */
function replaceOnce(html, anchor, replacement) {
  const at = html.indexOf(anchor);
  if (at === -1 || html.indexOf(anchor, at + anchor.length) !== -1) {
    throw new Error(
      `site-head-metadata: expected exactly one ${JSON.stringify(anchor)} in the compiled head`,
    );
  }
  return html.slice(0, at) + replacement + html.slice(at + anchor.length);
}

/**
 * Returns the landing HTML with the hosted-site head metadata added.
 * @param {string} html compiled landing page
 * @param {{ title: string, description: string, version: string }} meta
 */
export function addSiteHeadMetadata(html, { title, description, version }) {
  const pageUrl = `${SITE_ORIGIN}/`;
  const imageUrl = `${SITE_ORIGIN}${CARD.path}`;

  // The page links a web manifest, which a `default-src 'none'` policy would block.
  let out = replaceOnce(
    html,
    'connect-src &#39;none&#39;;',
    'connect-src &#39;none&#39;; manifest-src &#39;self&#39;;',
  );

  out = replaceOnce(
    out,
    '<meta property="og:type" content="article" />',
    [
      '<meta property="og:type" content="website" />',
      `<meta property="og:url" content="${pageUrl}" />`,
      '<meta property="og:site_name" content="AK Render" />',
      '<meta property="og:locale" content="en_US" />',
      `<meta property="og:image" content="${imageUrl}" />`,
      '<meta property="og:image:type" content="image/png" />',
      `<meta property="og:image:width" content="${CARD.width}" />`,
      `<meta property="og:image:height" content="${CARD.height}" />`,
      `<meta property="og:image:alt" content="${escapeAttr(CARD.alt)}" />`,
    ].join('\n'),
  );

  out = replaceOnce(
    out,
    '<meta name="twitter:card" content="summary" />',
    [
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
      `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
      `<meta name="twitter:image" content="${imageUrl}" />`,
      `<meta name="twitter:image:alt" content="${escapeAttr(CARD.alt)}" />`,
      `<link rel="canonical" href="${pageUrl}" />`,
      '<meta name="robots" content="index, follow, max-image-preview:large" />',
      '<meta name="author" content="AgentKit" />',
      `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLOR.light}" />`,
      `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLOR.dark}" />`,
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
      '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<link rel="manifest" href="/site.webmanifest" />',
      '<link rel="alternate" type="text/plain" href="/llms.txt" title="LLM summary" />',
      `<script type="application/ld+json">${jsonLd(structuredData({ title, description, version }))}</script>`,
    ].join('\n'),
  );

  return out;
}
