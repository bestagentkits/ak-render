/**
 * Theme token model.
 *
 * A theme is typed data, never CSS. Every token is declared here with its kind
 * and its bounds, so a preset — built-in or user-authored — can only set values
 * the compiler knows how to validate. There is deliberately no token kind that
 * accepts a free-form declaration, which is what makes "no CSS escape hatch" a
 * property of the type system rather than a promise.
 */

export type TokenKind =
  | 'color'
  | 'length'
  | 'font-stack'
  | 'elevation'
  | 'easing'
  | 'enum'
  | 'number';

export interface TokenSpec {
  kind: TokenKind;
  group: string;
  description: string;
  /** Allowed values for `enum` tokens. */
  values?: readonly string[];
  min?: number;
  max?: number;
}

const ELEVATIONS = ['none', 'subtle', 'medium', 'strong'] as const;
const EASINGS = ['ease', 'ease-in-out', 'linear'] as const;

export const TOKEN_SPECS: Readonly<Record<string, TokenSpec>> = {
  'color-background': { kind: 'color', group: 'color', description: 'Page background.' },
  'color-surface': { kind: 'color', group: 'color', description: 'Card and panel background.' },
  'color-surface-raised': { kind: 'color', group: 'color', description: 'Elevated surface.' },
  'color-border': { kind: 'color', group: 'color', description: 'Hairline border colour.' },
  'color-text': { kind: 'color', group: 'color', description: 'Primary text colour.' },
  'color-text-muted': { kind: 'color', group: 'color', description: 'Secondary text colour.' },
  'color-accent': { kind: 'color', group: 'color', description: 'Primary accent.' },
  'color-accent-contrast': {
    kind: 'color',
    group: 'color',
    description: 'Text colour placed on the accent.',
  },
  'color-info': { kind: 'color', group: 'color', description: 'Informational status colour.' },
  'color-success': { kind: 'color', group: 'color', description: 'Success status colour.' },
  'color-warning': { kind: 'color', group: 'color', description: 'Warning status colour.' },
  'color-danger': { kind: 'color', group: 'color', description: 'Danger status colour.' },

  'font-heading': {
    kind: 'font-stack',
    group: 'typography',
    description: 'Heading font stack. System stacks only; no remote fonts.',
  },
  'font-body': { kind: 'font-stack', group: 'typography', description: 'Body font stack.' },
  'font-mono': { kind: 'font-stack', group: 'typography', description: 'Monospace font stack.' },
  'font-size-base': { kind: 'length', group: 'typography', description: 'Base font size.' },
  'font-scale': {
    kind: 'number',
    group: 'typography',
    description: 'Modular scale ratio for heading sizes.',
    min: 1.05,
    max: 1.6,
  },
  'line-height': {
    kind: 'number',
    group: 'typography',
    description: 'Body line height multiplier.',
    min: 1.2,
    max: 2.2,
  },
  measure: { kind: 'length', group: 'typography', description: 'Maximum reading width.' },

  'space-unit': { kind: 'length', group: 'spacing', description: 'Base spacing unit.' },
  density: {
    kind: 'enum',
    group: 'spacing',
    description: 'Vertical rhythm between sections.',
    values: ['compact', 'comfortable', 'spacious'],
  },

  'radius-small': { kind: 'length', group: 'radius', description: 'Small corner radius.' },
  'radius-medium': { kind: 'length', group: 'radius', description: 'Default corner radius.' },
  'radius-large': { kind: 'length', group: 'radius', description: 'Large corner radius.' },

  'border-width': { kind: 'length', group: 'border', description: 'Default border width.' },
  'elevation-card': {
    kind: 'elevation',
    group: 'elevation',
    description: 'Card shadow strength.',
    values: ELEVATIONS,
  },
  'elevation-popover': {
    kind: 'elevation',
    group: 'elevation',
    description: 'Popover shadow strength.',
    values: ELEVATIONS,
  },

  'motion-duration': { kind: 'length', group: 'motion', description: 'Transition duration.' },
  'motion-easing': {
    kind: 'easing',
    group: 'motion',
    description: 'Transition easing function.',
    values: EASINGS,
  },
  'motion-policy': {
    kind: 'enum',
    group: 'motion',
    description: 'Whether transitions and animations run at all.',
    values: ['full', 'reduced', 'none'],
  },
};

export type Tokens = Record<string, string>;

/** Long-form descriptions keyed by token name, for `describe()`-style surfaces. */
export function tokenNames(): string[] {
  return Object.keys(TOKEN_SPECS).sort();
}

const COLOR_PATTERN = /^#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i;
/** CSS length or duration values, in units a preset may safely use. */
const LENGTH_PATTERN = /^-?\d+(?:\.\d+)?(?:px|rem|em|ch|ex|%|vw|vh|ms|s)$/;
const FONT_STACK_PATTERN = /^[A-Za-z0-9 ,'"\-._+]+$/;

/** True when a font stack cannot escape a CSS declaration. */
export function isSafeFontStack(value: string): boolean {
  if (!FONT_STACK_PATTERN.test(value)) return false;
  const lowered = value.toLowerCase();
  return !['url(', 'expression', 'javascript', '@import', '\\'].some((bad) =>
    lowered.includes(bad),
  );
}

export interface TokenProblem {
  token: string;
  message: string;
}

/** Validate one token value against its declared kind. */
export function validateTokenValue(token: string, value: unknown): TokenProblem | undefined {
  const spec = TOKEN_SPECS[token];
  if (spec === undefined) {
    return { token, message: 'unknown token' };
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { token, message: `expected a ${spec.kind} value` };
  }

  switch (spec.kind) {
    case 'color': {
      if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
        return { token, message: 'expected a hex colour such as #1a2b3c' };
      }
      return undefined;
    }
    case 'length': {
      if (typeof value !== 'string' || !LENGTH_PATTERN.test(value)) {
        return {
          token,
          message: 'expected a length or duration such as 16px, 1rem, 72ch, or 160ms',
        };
      }
      return undefined;
    }
    case 'font-stack': {
      if (typeof value !== 'string' || !isSafeFontStack(value)) {
        return { token, message: 'expected a font stack of names only (no url(), no expressions)' };
      }
      return undefined;
    }
    case 'elevation':
    case 'easing':
    case 'enum': {
      const allowed = spec.values ?? [];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        return { token, message: `expected one of: ${allowed.join(', ')}` };
      }
      return undefined;
    }
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return { token, message: 'expected a number' };
      if (spec.min !== undefined && numeric < spec.min) {
        return { token, message: `must be at least ${spec.min}` };
      }
      if (spec.max !== undefined && numeric > spec.max) {
        return { token, message: `must be at most ${spec.max}` };
      }
      return undefined;
    }
  }
}

/** Validate a partial token set, returning every problem found. */
export function validateTokens(tokens: Record<string, unknown>): TokenProblem[] {
  const problems: TokenProblem[] = [];
  for (const [token, value] of Object.entries(tokens)) {
    const problem = validateTokenValue(token, value);
    if (problem !== undefined) problems.push(problem);
  }
  return problems;
}

/** Fixed elevation shadows, so a preset cannot supply an arbitrary shadow. */
const ELEVATION_SHADOWS: Record<string, string> = {
  none: 'none',
  subtle: '0 1px 2px rgba(0, 0, 0, 0.06)',
  medium: '0 2px 8px rgba(0, 0, 0, 0.10)',
  strong: '0 8px 24px rgba(0, 0, 0, 0.16)',
};

/** Resolve a token to its CSS value, mapping symbolic tokens to fixed values. */
export function tokenCssValue(token: string, value: string): string {
  const spec = TOKEN_SPECS[token];
  if (spec?.kind === 'elevation') return ELEVATION_SHADOWS[value] ?? 'none';
  if (spec?.kind === 'easing') return value;
  if (spec?.kind === 'enum') return value;
  return value;
}

/** The CSS custom property name for a token. */
export function tokenVariable(token: string): string {
  return `--ak-${token}`;
}
