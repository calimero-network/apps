// Deterministic presentation helpers shared across the tracker views: stable
// avatar/label colours from a seed string, key truncation, and compact relative
// time. All pure so they are trivially unit-testable.

// Avatar/label swatches — drawn from the mockup plus a few extras for spread.
const SWATCHES = [
  '#A5FF3F', '#5FA8D3', '#C77DBB', '#8B9AA8',
  '#6E8BB5', '#E0A04B', '#7FC96B', '#B47FD6',
];

function hashString(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Stable swatch for an avatar seed (alias or public key). */
export function avatarColor(seed: string): string {
  return SWATCHES[hashString(seed) % SWATCHES.length];
}

/** Stable dot colour for a label name. */
export function labelColor(label: string): string {
  return SWATCHES[hashString(`label:${label}`) % SWATCHES.length];
}

/** Single leading glyph for an avatar (lowercase, matches the mockup). */
export function initial(seed: string): string {
  const c = seed.trim()[0];
  return c ? c.toLowerCase() : '?';
}

/** `4f8a…c2e1`-style truncation for a long public key. Short strings pass through. */
export function truncateKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Compact relative time (`2h`, `3d`, `now`) from an epoch value in s or ms. */
export function relativeTime(value: number, now: number = Date.now()): string {
  if (!value) return '';
  const ms = value < 1e12 ? value * 1000 : value; // tolerate seconds or millis
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(day / 365)}y`;
}

/** Longer created-at rendering (`Apr 2, 2026`). Empty for a missing value. */
export function formatDate(value: number): string {
  if (!value) return '—';
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
