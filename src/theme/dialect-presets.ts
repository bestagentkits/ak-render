/**
 * Dialect presets: built-ins that change component treatment through recipes,
 * not only colour and type.
 *
 * Each one reuses an already bundled face, so no new font asset ships. Every
 * palette keeps body text at 7:1 or more on the background, surface and raised
 * surface, and muted text, the accent and the four tones at 4.5:1 or more, in
 * both schemes (`tests/unit/theme-contrast.test.ts` enforces it).
 */

import {
  face,
  type PresetDefinition,
  preset,
  SYSTEM_MONO,
  SYSTEM_SANS,
  SYSTEM_SERIF,
} from './preset-builder.js';

export const DIALECT_PRESETS: Readonly<Record<string, PresetDefinition>> = {
  'data-console': preset({
    name: 'data-console',
    description:
      'Dense operations console: slate surfaces, a cyan accent, ledger tables and quiet charts.',
    typing: {
      'font-heading': face('Geist', SYSTEM_SANS),
      'font-body': face('Geist', SYSTEM_SANS),
      'font-mono': face('JetBrains Mono', SYSTEM_MONO),
    },
    structure: {
      density: 'compact',
      'font-scale': '1.2',
      'radius-small': '3px',
      'radius-medium': '6px',
      'radius-large': '10px',
    },
    recipes: {
      hero: 'compact',
      tables: 'ledger',
      charts: 'minimal',
      cards: 'flat',
      sections: 'divided',
    },
    colors: {
      light: {
        'color-background': '#f3f6f9',
        'color-surface': '#ffffff',
        'color-surface-raised': '#e9eef3',
        'color-border': '#cdd6e0',
        'color-text': '#0d1722',
        'color-text-muted': '#4a5868',
        'color-accent': '#0b6b80',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1d5a96',
        'color-success': '#1c6b45',
        'color-warning': '#835400',
        'color-danger': '#a3282a',
      },
      dark: {
        'color-background': '#0b1118',
        'color-surface': '#111a24',
        'color-surface-raised': '#182330',
        'color-border': '#273646',
        'color-text': '#dce6ef',
        'color-text-muted': '#93a4b6',
        'color-accent': '#4fd1e8',
        'color-accent-contrast': '#06222a',
        'color-info': '#7cb7f0',
        'color-success': '#5fcf98',
        'color-warning': '#e6b75a',
        'color-danger': '#f08a84',
      },
    },
  }),

  'executive-report': preset({
    name: 'executive-report',
    description:
      'Board-ready report: white and ink with a navy accent, headline metrics, outlined cards.',
    typing: {
      'font-heading': face('Inter Tight', SYSTEM_SANS),
      'font-body': face('Inter Tight', SYSTEM_SANS),
    },
    structure: {
      'radius-small': '2px',
      'radius-medium': '4px',
      'radius-large': '8px',
      measure: '70ch',
    },
    recipes: {
      metrics: 'headline',
      charts: 'minimal',
      sections: 'divided',
      cards: 'outlined',
    },
    colors: {
      light: {
        'color-background': '#ffffff',
        'color-surface': '#ffffff',
        'color-surface-raised': '#f3f5f8',
        'color-border': '#d9dee6',
        'color-text': '#0e1420',
        'color-text-muted': '#545e6e',
        'color-accent': '#1b3a6b',
        'color-accent-contrast': '#ffffff',
        'color-info': '#1f5394',
        'color-success': '#1e6a43',
        'color-warning': '#855300',
        'color-danger': '#a42b23',
      },
      dark: {
        'color-background': '#0c111b',
        'color-surface': '#121a28',
        'color-surface-raised': '#1a2436',
        'color-border': '#2c3a52',
        'color-text': '#e8edf5',
        'color-text-muted': '#a2aec0',
        'color-accent': '#8fb2ea',
        'color-accent-contrast': '#0c111b',
        'color-info': '#8fbbee',
        'color-success': '#7ccf9f',
        'color-warning': '#e2b866',
        'color-danger': '#f0928a',
      },
    },
  }),

  'product-studio': preset({
    name: 'product-studio',
    description:
      'Product launch page: soft neutral surfaces, a violet accent, framed media and raised cards.',
    typing: {
      'font-heading': face('Plus Jakarta Sans', SYSTEM_SANS),
      'font-body': face('Plus Jakarta Sans', SYSTEM_SANS),
    },
    structure: {
      density: 'spacious',
      'radius-small': '8px',
      'radius-medium': '14px',
      'radius-large': '24px',
      'elevation-card': 'medium',
      'elevation-popover': 'strong',
    },
    recipes: { media: 'framed', cards: 'raised' },
    colors: {
      light: {
        'color-background': '#f7f6f9',
        'color-surface': '#ffffff',
        'color-surface-raised': '#f0eef5',
        'color-border': '#e2deea',
        'color-text': '#1b1825',
        'color-text-muted': '#5f5a6e',
        'color-accent': '#6233c9',
        'color-accent-contrast': '#ffffff',
        'color-info': '#2c5aa8',
        'color-success': '#23704a',
        'color-warning': '#87560a',
        'color-danger': '#a6303a',
      },
      dark: {
        'color-background': '#121019',
        'color-surface': '#1a1724',
        'color-surface-raised': '#241f31',
        'color-border': '#3a3349',
        'color-text': '#eeebf5',
        'color-text-muted': '#ada6bf',
        'color-accent': '#b9a0ff',
        'color-accent-contrast': '#16112a',
        'color-info': '#92b8f2',
        'color-success': '#82d1a6',
        'color-warning': '#e8bb6c',
        'color-danger': '#f39aa2',
      },
    },
  }),

  'research-notebook': preset({
    name: 'research-notebook',
    description:
      'Lab notebook: paper with an oxblood accent, serif reading type, ledger tables and outlined notes.',
    typing: {
      'font-heading': face('Fraunces', SYSTEM_SERIF),
      'font-body': SYSTEM_SERIF,
      'line-height': '1.72',
    },
    structure: {
      'font-size-base': '17px',
      'font-scale': '1.3',
      measure: '68ch',
      'elevation-card': 'none',
    },
    recipes: {
      callouts: 'outlined',
      tables: 'ledger',
      hero: 'compact',
      cards: 'flat',
    },
    colors: {
      light: {
        'color-background': '#f8f4ec',
        'color-surface': '#fffdf8',
        'color-surface-raised': '#f1ebdf',
        'color-border': '#ddd3c1',
        'color-text': '#221c17',
        'color-text-muted': '#635a4f',
        'color-accent': '#7d1f2a',
        'color-accent-contrast': '#ffffff',
        'color-info': '#2a587a',
        'color-success': '#3c6835',
        'color-warning': '#7f560f',
        'color-danger': '#9a2a1f',
      },
      dark: {
        'color-background': '#191512',
        'color-surface': '#221d19',
        'color-surface-raised': '#2d2621',
        'color-border': '#463c33',
        'color-text': '#f1e9de',
        'color-text-muted': '#b8ab99',
        'color-accent': '#e79aa0',
        'color-accent-contrast': '#1e1210',
        'color-info': '#94bfdc',
        'color-success': '#9fc792',
        'color-warning': '#e3b878',
        'color-danger': '#f09b8c',
      },
    },
  }),
};
