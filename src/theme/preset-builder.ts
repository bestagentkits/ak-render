/**
 * The shared builder behind every built-in preset.
 *
 * A preset states only what makes it distinct (colours, voice, structure and
 * component recipes); the builder fills the structural defaults and the
 * system font stacks, then splits the result into the light and dark token
 * sets the resolver consumes.
 */

import type { ThemeRecipeSurface } from './recipes.js';
import type { Tokens } from './tokens.js';

export interface PresetDefinition {
  name: string;
  description: string;
  light: Tokens;
  dark: Tokens;
  /** Component recipes this preset selects; unset surfaces keep their default. */
  recipes?: Partial<Record<ThemeRecipeSurface, string>>;
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

export const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
export const SYSTEM_SERIF = 'ui-serif, Georgia, Times New Roman, serif';
export const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** A bundled face in front of its system fallback. */
export const face = (family: string, fallback: string): string => `AK ${family}, ${fallback}`;

export interface PresetInput {
  name: string;
  description: string;
  colors: { light: Tokens; dark: Tokens };
  typing?: Tokens;
  structure?: Tokens;
  recipes?: Partial<Record<ThemeRecipeSurface, string>>;
}

export function preset(input: PresetInput): PresetDefinition {
  const shared: Tokens = {
    ...STRUCTURAL,
    'font-heading': SYSTEM_SANS,
    'font-body': SYSTEM_SANS,
    'font-mono': SYSTEM_MONO,
    ...input.typing,
    ...input.structure,
  };
  const definition: PresetDefinition = {
    name: input.name,
    description: input.description,
    light: { ...shared, ...input.colors.light },
    dark: { ...shared, ...input.colors.dark },
  };
  if (input.recipes !== undefined) definition.recipes = { ...input.recipes };
  return definition;
}
