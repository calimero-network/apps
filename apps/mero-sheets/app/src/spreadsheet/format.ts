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
  const { kind, code, decimals, style } = parseFormat(format);
  if (!kind || kind === 'general' || kind === 'text') return computed;

  if (kind === 'date') {
    const t = Date.parse(computed);
    if (Number.isNaN(t)) return computed;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    switch (style) {
      case 'us': return `${m}/${day}/${y}`;
      case 'eu': return `${day}/${m}/${y}`;
      case 'long': return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
      default: return `${y}-${m}-${day}`;
    }
  }

  // Numeric formats: bail out (unchanged) on empty or non-numeric input.
  if (computed.trim() === '') return computed;
  const n = Number(computed);
  if (!Number.isFinite(n)) return computed;

  const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  switch (kind) {
    case 'number':
      return new Intl.NumberFormat('en-US', digits).format(n);
    case 'currency':
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, ...digits }).format(n);
      } catch {
        // An unknown currency code: show the number with the code after it.
        return `${new Intl.NumberFormat('en-US', digits).format(n)} ${code}`;
      }
    case 'percent':
      return new Intl.NumberFormat('en-US', { style: 'percent', ...digits }).format(n);
    default:
      return computed;
  }
}

/**
 * A format keyword's parts. `number`, `number:3`; `currency`, `currency:EUR`,
 * `currency:EUR:0`; `percent`, `percent:1`; `date`, `date:us|eu|long`; `text`.
 */
export function parseFormat(format: string): { kind: string; code: string; decimals: number; style: string } {
  const [kind = '', a = '', b = ''] = format.trim().split(':');
  const digits = (s: string, fallback: number) => {
    const n = Number(s);
    return s !== '' && Number.isInteger(n) && n >= 0 && n <= 10 ? n : fallback;
  };
  switch (kind) {
    case 'number': return { kind, code: '', decimals: digits(a, 2), style: '' };
    case 'currency': return { kind, code: (a || 'USD').toUpperCase(), decimals: digits(b, 2), style: '' };
    case 'percent': return { kind, code: '', decimals: digits(a, 0), style: '' };
    case 'date': return { kind, code: '', decimals: 0, style: a };
    default: return { kind, code: '', decimals: 0, style: '' };
  }
}

/**
 * The format with one more (`delta` 1) or one fewer (-1) decimal place. A
 * cell with no numeric format becomes a number with 2 ± 1 places.
 */
export function changeDecimals(format: string, delta: number): string {
  const { kind, code, decimals } = parseFormat(format);
  const next = (d: number) => Math.max(0, Math.min(10, d + delta));
  switch (kind) {
    case 'currency': return `currency:${code}:${next(decimals)}`;
    case 'percent': return `percent:${next(decimals)}`;
    case 'number': return `number:${next(decimals)}`;
    default: return `number:${next(2)}`;
  }
}
