const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

/** Escape HTML entities so user content cannot break an HTML template literal. */
export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/** Escape CSS property values — strip anything that could close a style block. */
export function escapeCss(raw: string): string {
  return raw.replace(/[{}\\;]/g, "");
}

export const MAX_COMMENT_LEN = 2000;
export const MAX_REPLY_LEN   = 500;
export const MAX_TEXT_LEN    = 500;

/** Trim and hard-cap a string at `max` bytes. */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) : t;
}
