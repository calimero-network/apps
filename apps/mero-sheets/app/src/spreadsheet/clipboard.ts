/**
 * System-clipboard TSV serialization for copy/paste. TSV carries only cell
 * *values* (not formulas), so it is the cross-app format; full-fidelity in-app
 * paste uses the internal payload in paste.ts. The formula language has no tab
 * or newline literals, so no quoting is needed.
 */

/** Rectangular grid of cell strings → TSV (cells by tab, rows by newline). */
export function toTSV(values: string[][]): string {
  return values.map((row) => row.join('\t')).join('\n');
}

/** TSV → grid of cell strings. A single trailing newline is dropped (external
 *  apps append one); ragged rows are preserved as-is. */
export function fromTSV(text: string): string[][] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').map((line) => line.split('\t'));
}
