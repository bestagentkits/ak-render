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
  /** Short description for catalog output. */
  readonly description: string;
}

export const EMBED_PROVIDERS: Readonly<Record<string, EmbedProvider>> = {
  youtube: {
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
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
export function hostMatchesProvider(provider: string, reference: string): boolean {
  const entry = EMBED_PROVIDERS[provider];
  if (entry === undefined) return false;
  const host = hostOf(reference);
  if (host === undefined) return false;
  return entry.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** True when the reference belongs to any provider in the allowlist. */
export function hostMatchesAnyProvider(providers: readonly string[], reference: string): boolean {
  return providers.some((provider) => hostMatchesProvider(provider, reference));
}
