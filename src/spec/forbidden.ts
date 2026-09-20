/**
 * Forbidden-key scan.
 *
 * Two independent things must be true for the trust boundary to hold: an
 * author must not be able to smuggle executable or presentational-script
 * content into a spec through a property name, and a typo must not silently
 * become a no-op. This scan runs before schema validation so the failure is
 * reported as a policy violation with the exact path, not as an
 * unknown-property error that a reader might "fix" by adding the key to a
 * schema.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject } from '../json.js';

/**
 * Keys that must never appear anywhere in a Page Spec.
 *
 * `style` is included deliberately: a spec cannot carry CSS, and a theme is
 * typed token data rather than a stylesheet escape hatch.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'html',
  'rawhtml',
  'innerhtml',
  'outerhtml',
  'srcdoc',
  'css',
  'stylesheet',
  'style',
  'script',
  'javascript',
  'js',
  'eval',
  'expression',
  'handler',
  'iframe',
  'embed',
  'object',
  'formaction',
  'dangerouslysetinnerhtml',
  'template',
];

/** Snake-case and kebab-case event-handler attributes. */
const HANDLER_KEY =
  /^(onclick|onchange|oninput|onsubmit|onload|onerror|onfocus|onblur|onkeydown|onkeyup|onkeypress|onmouseover|onmouseout|onmousedown|onmouseup|ondblclick|oncontextmenu|onscroll|onwheel|ontoggle|onanimationstart|ontransitionend|onpointerdown|onpointerup)$/i;

/** Camel-case handler properties (`onClick`, `onError`, ...). `on` itself is allowed. */
const CAMEL_HANDLER_KEY = /^on[A-Z]/;

function isForbiddenKey(key: string): boolean {
  if (FORBIDDEN_KEYS.includes(key.toLowerCase())) return true;
  if (key === 'on') return false;
  return HANDLER_KEY.test(key) || CAMEL_HANDLER_KEY.test(key);
}

/**
 * Walk the raw document and report every forbidden key.
 *
 * `elements` is a permitted key name: HTML template content lives in compiler
 * code, never in a spec.
 */
export function scanForbiddenKeys(value: unknown, bag: DiagnosticBag): void {
  const seen = new Set<object>();

  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        visit(node[index], pathIndex(path, index));
      }
      return;
    }
    if (!isPlainObject(node)) return;

    for (const [key, child] of Object.entries(node)) {
      const childPath = pathKey(path, key);
      if (isForbiddenKey(key)) {
        bag.add({
          code: 'POLICY_VIOLATION',
          path: childPath,
          message: `"${key}" is not accepted in a Page Spec: presentation and behavior belong to the compiler`,
          details: { key },
        });
        continue;
      }
      visit(child, childPath);
    }
  };

  visit(value, '$');
}
