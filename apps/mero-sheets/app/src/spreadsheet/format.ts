/**
 * Render a cell's computed value for display according to its format keyword.
 * Pure and DOM-free so it is unit-testable and identical in the grid and CSV
 * export. Display-only: the underlying value and formulas are unaffected.
 *
 * Fallback rule: anything that isn't a finite number (for number/currency/
 * percent) or a parseable date (for date) is returned unchanged — never
 * `NaN`/`Invalid Date`. Error strings like `#REF!` therefore pass through.
 */
export function formatValue(computed: string, format: string): string {
  const fmt = format.trim();
  if (!fmt || fmt === 'general') return computed;

  if (fmt === 'date') {
    const t = Date.parse(computed);
    if (Number.isNaN(t)) return computed;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Numeric formats: bail out (unchanged) on empty or non-numeric input.
  if (computed.trim() === '') return computed;
  const n = Number(computed);
  if (!Number.isFinite(n)) return computed;

  switch (fmt) {
    case 'number':
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(n);
    case 'percent':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 0,
      }).format(n);
    default:
      return computed;
  }
}
