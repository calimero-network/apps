// The name to SUGGEST when someone opens a spreadsheet for the first time.
//
// ── Why this is in localStorage and the real nickname is not ─────────────────
//
// The nickname that other people see lives in the CONTRACT (`join(nickname)`),
// because that is the only place a name can live if anybody else is to read it —
// localStorage is per-browser, so a name kept there is visible to exactly the
// one person who does not need it.
//
// What lives here is different and much smaller: the last name you typed, so
// the second spreadsheet you open does not ask you to type it again. Losing it
// costs one keystroke session, which is the right price for something that must
// never be load-bearing. So every access is wrapped — `localStorage` throws
// outright in Safari private mode and when site data is blocked — and the
// callers treat "" as "ask".

const KEY = 'mero-sheets:display-name';

/** Longest name the contract will accept (`validate_label`, MAX_LABEL_LEN). */
export const MAX_NAME_LEN = 64;

/**
 * Trim and clamp a typed name to what the contract accepts.
 *
 * Done on the way IN rather than only validating on submit, because the
 * alternative is a round-trip that fails with "invalid input: label must be at
 * most 64 characters" — a message written for a developer.
 */
export function normaliseName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return Array.from(trimmed).slice(0, MAX_NAME_LEN).join('');
}

/** True when a name is something the contract will accept. */
export function isUsableName(raw: string): boolean {
  const n = normaliseName(raw);
  return n.length > 0 && Array.from(n).length <= MAX_NAME_LEN;
}

/** The last name this browser used, or "" when there is none. */
export function rememberedName(): string {
  try {
    return normaliseName(window.localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

/** Remember a name as the default for the next spreadsheet. Never throws. */
export function rememberName(name: string): void {
  try {
    const n = normaliseName(name);
    if (n) window.localStorage.setItem(KEY, n);
  } catch {
    /* private mode / blocked site data — the name just is not suggested next time */
  }
}
