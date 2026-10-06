/**
 * The committed Cloudflare configuration agrees with the code that relies on it:
 * every rate-limit class the worker reads has a binding with the documented
 * limit, and the R2 lifecycle rules outlive the expiry the worker enforces.
 */

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_TTL_SECONDS,
  RATE_LIMITS,
  RATE_WINDOW_SECONDS,
  type RateLimitKey,
  retentionDays,
} from '../../apps/cloud/src/config.js';
import { RATE_LIMIT_BINDINGS } from '../../apps/cloud/src/rate-limit.js';

const ROOT = new URL('../../apps/cloud/', import.meta.url);

interface RateLimitEntry {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

interface WranglerConfig {
  vars: Record<string, string>;
  ratelimits: RateLimitEntry[];
  kv_namespaces?: unknown[];
}

interface LifecycleRule {
  id: string;
  enabled: boolean;
  conditions: { prefix?: string };
  deleteObjectsTransition?: { condition: { type: string; maxAge: number } };
}

function wrangler(): WranglerConfig {
  const path = new URL('wrangler.jsonc', ROOT);
  // TypeScript's JSONC reader handles the comments wrangler.jsonc carries.
  const parsed = ts.parseConfigFileTextToJson(path.pathname, readFileSync(path, 'utf8'));
  if (parsed.error !== undefined) throw new Error('wrangler.jsonc does not parse');
  return parsed.config as WranglerConfig;
}

const DAY_SECONDS = 24 * 60 * 60;

describe('cloud deploy config', () => {
  it('declares one rate-limit binding per class with the limits config.ts documents', () => {
    const { ratelimits, kv_namespaces } = wrangler();
    const byName = new Map(ratelimits.map((entry) => [entry.name, entry]));
    for (const [key, binding] of Object.entries(RATE_LIMIT_BINDINGS)) {
      const entry = byName.get(binding);
      expect(entry, binding).toBeDefined();
      expect(entry?.simple).toEqual({
        limit: RATE_LIMITS[key as RateLimitKey],
        period: RATE_WINDOW_SECONDS,
      });
      expect(entry?.namespace_id).toMatch(/^[1-9][0-9]*$/u);
    }
    expect(ratelimits).toHaveLength(Object.keys(RATE_LIMIT_BINDINGS).length);
    const ids = ratelimits.map((entry) => entry.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
    // The KV fixed-window limiter is gone; nothing reads a KV namespace.
    expect(kv_namespaces).toBeUndefined();
  });

  it('expires R2 objects by lifecycle rule after the worker stops serving them', () => {
    const { rules } = JSON.parse(readFileSync(new URL('r2-lifecycle.json', ROOT), 'utf8')) as {
      rules: LifecycleRule[];
    };
    const expiry = (prefix: string) =>
      rules.find((rule) => rule.enabled && rule.conditions.prefix === prefix)
        ?.deleteObjectsTransition?.condition;

    // Lifecycle ages are whole days, so the artifact rule is one day.
    expect(expiry('artifact/')).toEqual({ type: 'Age', maxAge: DAY_SECONDS });
    expect(DAY_SECONDS).toBeGreaterThan(ARTIFACT_TTL_SECONDS);

    // Shares: the configured retention plus one day of slack.
    const days = retentionDays(wrangler().vars);
    expect(expiry('share/')).toEqual({ type: 'Age', maxAge: (days + 1) * DAY_SECONDS });
  });
});
