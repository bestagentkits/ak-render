import type { Page, Request } from '@playwright/test';

/**
 * Zero-network audit harness.
 *
 * The canonical AK Render artifact must open from `file://` and issue zero
 * external requests. Every later milestone reuses this harness against real
 * compiler output, so it is exercised here with a positive and a negative
 * control: a guard that cannot detect a violation is worthless.
 */

const LOCAL_PROTOCOLS = new Set(['file:', 'data:', 'about:', 'blob:']);

/** True when a request URL leaves the local/embedded origin set. */
export function isExternalRequest(url: string): boolean {
  try {
    return !LOCAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return true;
  }
}

export interface NetworkAudit {
  /** Every request URL observed since the audit started. */
  requests: string[];
  /** Requests that would violate the offline contract. */
  external: string[];
}

/** Start recording requests. Attach before navigation or content injection. */
export function startNetworkAudit(page: Page): () => NetworkAudit {
  const requests: string[] = [];
  page.on('request', (request: Request) => {
    requests.push(request.url());
  });
  return () => ({
    requests: [...requests],
    external: requests.filter(isExternalRequest),
  });
}
