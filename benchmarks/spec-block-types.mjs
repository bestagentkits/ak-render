/**
 * Block types a Page Spec uses, read from the compiler's own IR (the built
 * library in dist/), so nested slots count and prop values that happen to be
 * named `type` (a data-table column type, for example) do not. Sorted, unique,
 * and without the implicit `page` root.
 */

import { normalize } from '../dist/index.js';

export function specBlockTypes(spec) {
  const types = new Set(normalize(spec).nodes.map((node) => node.type));
  types.delete('page');
  return [...types].sort();
}
