/**
 * Network-backed media providers.
 *
 * A page never embeds a remote frame: the compiler emits no iframe at all, so a
 * provider reference can only ever become a poster, a link, or a direct media
 * source. This module defines the closed provider vocabulary and the hosts each
 * provider may be referenced from, so a spec cannot point a "YouTube" block at
 * an arbitrary domain and have the policy treat it as trusted.
 */

export interface EmbedProvider {
  readonly label: string;
  /** Hosts the provider serves content from; a subdomain of any of these matches. */
  readonly hosts: readonly string[];
  /**
   * CDN hosts the provider serves images and video files from, such as
   * `pbs.twimg.com`. They pass a page's provider allowlist for loaded assets
   * only: a block that names the provider still needs a page host.
   */
  readonly assetHosts?: readonly string[];
  /** Short description for catalog output. */
  readonly description: string;
}

export const EMBED_PROVIDERS: Readonly<Record<string, EmbedProvider>> = {
  youtube: {
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    assetHosts: ['ytimg.com', 'ggpht.com'],
    description: 'YouTube video page or short link.',
  },
  vimeo: {
    label: 'Vimeo',
    hosts: ['vimeo.com'],
    description: 'Vimeo video page or player link.',
  },
  spotify: {
    label: 'Spotify',
    hosts: ['open.spotify.com'],
    description: 'Spotify track, album, playlist, or episode.',
  },
  soundcloud: {
    label: 'SoundCloud',
    hosts: ['soundcloud.com'],
    description: 'SoundCloud track or set.',
  },
  x: {
    label: 'X',
    hosts: ['x.com', 'twitter.com'],
    assetHosts: ['twimg.com'],
    description: 'X (Twitter) post; avatars and media from twimg.com.',
  },
  threads: {
    label: 'Threads',
    hosts: ['threads.net', 'threads.com'],
    assetHosts: ['cdninstagram.com', 'fbcdn.net'],
    description: 'Threads post; its media URLs are signed and expire.',
  },
  bluesky: {
    label: 'Bluesky',
    hosts: ['bsky.app'],
    assetHosts: ['cdn.bsky.app', 'video.bsky.app'],
    description: 'Bluesky post; avatars and media from cdn.bsky.app.',
  },
  linkedin: {
    label: 'LinkedIn',
    hosts: ['linkedin.com'],
    assetHosts: ['licdn.com'],
    description: 'LinkedIn post; media from licdn.com.',
  },
  reddit: {
    label: 'Reddit',
    hosts: ['reddit.com', 'redd.it'],
    assetHosts: ['redditmedia.com', 'redditstatic.com'],
    description: 'Reddit post; i.redd.it and preview.redd.it media.',
  },
  hackernews: {
    label: 'Hacker News',
    hosts: ['news.ycombinator.com'],
    description: 'Hacker News story or comment.',
  },
};

export const EMBED_PROVIDER_NAMES: readonly string[] = Object.keys(EMBED_PROVIDERS).sort();

export function isEmbedProvider(name: string): boolean {
  return Object.hasOwn(EMBED_PROVIDERS, name);
}

function hostOf(reference: string): string | undefined {
  try {
    return new URL(reference).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * True when a remote reference belongs to the named provider.
 *
 * Matching is on the parsed hostname, so `https://youtube.com.evil.example/`
 * does not match `youtube.com` and a lookalike host cannot inherit a provider's
 * allowlist entry.
 */
export function hostMatchesProvider(
  provider: string,
  reference: string,
  options: { assets?: boolean } = {},
): boolean {
  const entry = EMBED_PROVIDERS[provider];
  if (entry === undefined) return false;
  const host = hostOf(reference)?.replace(/\.$/u, '');
  if (host === undefined || host === '') return false;
  const hosts =
    options.assets === true ? [...entry.hosts, ...(entry.assetHosts ?? [])] : entry.hosts;
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * True when the reference belongs to any provider in the allowlist. With
 * `assets`, a provider's CDN hosts count too, for a loaded image or video file.
 */
export function hostMatchesAnyProvider(
  providers: readonly string[],
  reference: string,
  options: { assets?: boolean } = {},
): boolean {
  return providers.some((provider) => hostMatchesProvider(provider, reference, options));
}
