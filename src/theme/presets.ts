/**
 * Built-in theme presets.
 *
 * The presets carry over the curated visual language that the legacy HTML
 * references owned in prose (see `docs/adr/0001-page-spec-compiler-boundary.md`
 * and `html-design-guidelines.md`), now as validated token data.
 *
 * Fonts are system stacks only: the offline contract forbids a network fetch, so
 * nothing here can reference a webfont, and therefore nothing here needs a font
 * licence.
 */

import type { Tokens } from './tokens.js';

export interface PresetDefinition {
  name: string;
  description: string;
  light: Tokens;
  dark: Tokens;
}

/** Structural defaults shared by every preset; each preset overrides colours and voice. */
const STRUCTURAL: Tokens = {
  'font-size-base': '16px',
  'font-scale': '1.25',
  'line-height': '1.65',
  measure: '72ch',
  'space-unit': '8px',
  density: 'comfortable',
  'radius-small': '4px',
  'radius-medium': '8px',
  'radius-large': '16px',
  'border-width': '1px',
  'elevation-card': 'subtle',
  'elevation-popover': 'medium',
  'motion-duration': '160ms',
  'motion-easing': 'ease',
  'motion-policy': 'full',
};

const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
const SYSTEM_SERIF = 'ui-serif, Georgia, Times New Roman, serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

interface PresetInput {
  name: string;
  description: string;
  colors: { light: Tokens; dark: Tokens };
  typing?: Tokens;
  structure?: Tokens;
}

function preset(input: PresetInput): PresetDefinition {
  const shared: Tokens = {
    ...STRUCTURAL,
    'font-heading': SYSTEM_SANS,
    'font-body': SYSTEM_SANS,
    'font-mono': SYSTEM_MONO,
    ...input.typing,
    ...input.structure,
  };
  return {
    name: input.name,
    description: input.description,
    light: { ...shared, ...input.colors.light },
    dark: { ...shared, ...input.colors.dark },
  };
}

/**
 * Palette notes, kept next to the data so a reviewer can check the intent:
 * every preset pairs a warm/cool background with a matching accent family, uses
 * a tinted hairline border rather than a neutral grey, and keeps body text at a
 * contrast ratio above 7:1 against its background.
 */
export const PRESETS: Readonly<Record<string, PresetDefinition>> = {
  blueprint: preset({
    name: 'blueprint',
    description: 'Technical drawing: cool slate surfaces, precise borders, monospace labels.',
    typing: { 'font-heading': SYSTEM_SANS, 'font-mono': SYSTEM_MONO },
    colors: {
      light: {
        'color-background': '#f0f4f8',
        'color-surface': '#ffffff',
        'color-surface-raised': '#e8eef4',
        'color-border': '#c2d2e2',
        'color-text': '#122334',
        'color-text-muted': '#4b6480',
        'color-accent': '#1a5fa8',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1a5fa8',
        'color-success': '#1d6f4a',
        'color-warning': '#8a5a00',
        'color-danger': '#a32a1f',
      },
      dark: {
        'color-background': '#0d1421',
        'color-surface': '#111d2e',
        'color-surface-raised': '#162438',
        'color-border': '#2b4360',
        'color-text': '#dbe7f3',
        'color-text-muted': '#93a9c0',
        'color-accent': '#6aa9e9',
        'color-accent-contrast': '#08111c',
        'color-info': '#6aa9e9',
        'color-success': '#63c194',
        'color-warning': '#e0b055',
        'color-danger': '#ef8a7d',
      },
    },
  }),

  editorial: preset({
    name: 'editorial',
    description: 'Serif headlines, generous whitespace, deep navy with gold accents.',
    typing: { 'font-heading': SYSTEM_SERIF, 'font-body': SYSTEM_SERIF, 'line-height': '1.7' },
    structure: { 'font-size-base': '17px', 'font-scale': '1.333', measure: '68ch' },
    colors: {
      light: {
        'color-background': '#faf8f2',
        'color-surface': '#ffffff',
        'color-surface-raised': '#f5f0e6',
        'color-border': '#e0d9c8',
        'color-text': '#1a1814',
        'color-text-muted': '#6b6558',
        'color-accent': '#8a6100',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1f4e79',
        'color-success': '#2f6b46',
        'color-warning': '#8a6100',
        'color-danger': '#9c2c25',
      },
      dark: {
        'color-background': '#0f1729',
        'color-surface': '#162040',
        'color-surface-raised': '#1d2b52',
        'color-border': '#35446b',
        'color-text': '#f0ece0',
        'color-text-muted': '#b0a890',
        'color-accent': '#e2c069',
        'color-accent-contrast': '#1a1814',
        'color-info': '#8fb8e0',
        'color-success': '#88c9a1',
        'color-warning': '#e2c069',
        'color-danger': '#eb9a90',
      },
    },
  }),

  'paper-ink': preset({
    name: 'paper-ink',
    description: 'Warm cream paper with terracotta and sage; informal and readable.',
    typing: { 'font-heading': SYSTEM_SANS, 'font-body': SYSTEM_SANS },
    colors: {
      light: {
        'color-background': '#faf6f0',
        'color-surface': '#ffffff',
        'color-surface-raised': '#fffdf5',
        'color-border': '#e5dccd',
        'color-text': '#2c2a25',
        'color-text-muted': '#6f675c',
        'color-accent': '#a83a10',
        'color-accent-contrast': '#ffffff',
        'color-info': '#2f5f7a',
        'color-success': '#42703a',
        'color-warning': '#8a5a12',
        'color-danger': '#9c2f21',
      },
      dark: {
        'color-background': '#1c1916',
        'color-surface': '#262220',
        'color-surface-raised': '#332d29',
        'color-border': '#4a423b',
        'color-text': '#f2eae0',
        'color-text-muted': '#b3a89a',
        'color-accent': '#e8865c',
        'color-accent-contrast': '#1c1916',
        'color-info': '#8dbdd8',
        'color-success': '#96c288',
        'color-warning': '#e0b273',
        'color-danger': '#ef9c90',
      },
    },
  }),

  'terminal-mono': preset({
    name: 'terminal-mono',
    description: 'Near-black terminal with green and amber, monospace throughout.',
    typing: { 'font-heading': SYSTEM_MONO, 'font-body': SYSTEM_MONO },
    structure: {
      'radius-small': '2px',
      'radius-medium': '3px',
      'radius-large': '6px',
      density: 'compact',
    },
    colors: {
      light: {
        'color-background': '#f4f4ef',
        'color-surface': '#ffffff',
        'color-surface-raised': '#eaeae2',
        'color-border': '#cfcfc2',
        'color-text': '#16180f',
        'color-text-muted': '#565a45',
        'color-accent': '#1f6b3a',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1f4e79',
        'color-success': '#1f6b3a',
        'color-warning': '#7a5200',
        'color-danger': '#952c22',
      },
      dark: {
        'color-background': '#05070c',
        'color-surface': '#0b1017',
        'color-surface-raised': '#131a23',
        'color-border': '#2a3440',
        'color-text': '#d3e4d3',
        'color-text-muted': '#84997f',
        'color-accent': '#5fd08a',
        'color-accent-contrast': '#05070c',
        'color-info': '#7fb6e8',
        'color-success': '#5fd08a',
        'color-warning': '#e8c15f',
        'color-danger': '#ef8b7f',
      },
    },
  }),

  'swiss-clean': preset({
    name: 'swiss-clean',
    description: 'Neutral high-contrast grid: one red accent, no decoration.',
    typing: { 'font-heading': SYSTEM_SANS, 'font-body': SYSTEM_SANS },
    structure: {
      'radius-small': '0px',
      'radius-medium': '0px',
      'radius-large': '0px',
      'elevation-card': 'none',
      'elevation-popover': 'subtle',
      'font-scale': '1.2',
      measure: '76ch',
    },
    colors: {
      light: {
        'color-background': '#ffffff',
        'color-surface': '#ffffff',
        'color-surface-raised': '#f4f4f4',
        'color-border': '#d4d4d4',
        'color-text': '#111111',
        'color-text-muted': '#5a5a5a',
        'color-accent': '#c02418',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1a4f8a',
        'color-success': '#1c6b3f',
        'color-warning': '#8a5a00',
        'color-danger': '#c02418',
      },
      dark: {
        'color-background': '#101010',
        'color-surface': '#181818',
        'color-surface-raised': '#232323',
        'color-border': '#3a3a3a',
        'color-text': '#f5f5f5',
        'color-text-muted': '#b0b0b0',
        'color-accent': '#ff6a5c',
        'color-accent-contrast': '#101010',
        'color-info': '#8ab6ea',
        'color-success': '#7fd0a1',
        'color-warning': '#e6bb63',
        'color-danger': '#ff6a5c',
      },
    },
  }),

  'warm-signal': preset({
    name: 'warm-signal',
    description: 'Warm neutral surfaces signalling with amber and emerald, data-friendly.',
    typing: { 'font-heading': SYSTEM_SANS, 'font-body': SYSTEM_SANS },
    structure: { density: 'spacious', 'radius-medium': '12px', 'radius-large': '20px' },
    colors: {
      light: {
        'color-background': '#fbf7f1',
        'color-surface': '#ffffff',
        'color-surface-raised': '#f6efe3',
        'color-border': '#e6dbc8',
        'color-text': '#2a2620',
        'color-text-muted': '#6e6558',
        'color-accent': '#8a5a00',
        'color-accent-contrast': '#ffffff',
        'color-info': '#2a5f86',
        'color-success': '#2c6b3f',
        'color-warning': '#8a5a00',
        'color-danger': '#9a2f22',
      },
      dark: {
        'color-background': '#181410',
        'color-surface': '#221d17',
        'color-surface-raised': '#2e2820',
        'color-border': '#453b2f',
        'color-text': '#f3ece1',
        'color-text-muted': '#b5a894',
        'color-accent': '#e5b567',
        'color-accent-contrast': '#181410',
        'color-info': '#8ec0e2',
        'color-success': '#8fc79c',
        'color-warning': '#e5b567',
        'color-danger': '#eda091',
      },
    },
  }),
};

/** Default preset used when a spec does not name one. */
export const DEFAULT_PRESET = 'editorial';

export function presetNames(): string[] {
  return Object.keys(PRESETS).sort();
}
