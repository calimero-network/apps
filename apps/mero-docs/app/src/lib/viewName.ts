// A view's name as the registry accepts it: 1 to 60 UTF-8 bytes once trimmed,
// so a wide-character name reaches the limit well before 60 characters.

export const VIEW_NAME_MAX = 60; // UTF-8 bytes, the registry's limit
export const VIEW_NAME_TOO_LONG = 'That name is too long.';

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

export function viewNameFits(name: string): boolean {
  return byteLength(name.trim()) <= VIEW_NAME_MAX;
}

/** The longest start of `name` that fits, cut between code points and trimmed of a trailing separator. */
export function cutViewName(name: string): string {
  let out = '';
  let bytes = 0;
  for (const ch of name) {
    bytes += byteLength(ch);
    if (bytes > VIEW_NAME_MAX) break;
    out += ch;
  }
  return out.replace(/[,\s]+$/, '');
}
