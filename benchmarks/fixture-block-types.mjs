/**
 * Distinct block types a Page Spec uses, in first-use order, read from the
 * compiled IR rather than the YAML text so quoted values, flow maps and nested
 * `type:` keys cannot shrink or break the list. Includes the `page` root: an
 * agent describes it like any other block it writes.
 *
 * @param {(source: string, options: { source: string }) => { ir: { nodes: { type: string }[] } }} compile
 * @param {string} source Page Spec text.
 * @param {string} name Fixture name, for diagnostics.
 * @returns {string[]}
 */
export function blockTypes(compile, source, name) {
  return [...new Set(compile(source, { source: name }).ir.nodes.map((node) => node.type))];
}
