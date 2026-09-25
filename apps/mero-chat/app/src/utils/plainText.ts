/**
 * Flatten message HTML to plain text for notification bodies.
 *
 * Message text is rich-editor HTML (`<p>hi <strong>there</strong></p>`). OS
 * banners and the notification centre render it verbatim, so the user sees the
 * tags. Truncating first made it worse — the cut lands mid-tag.
 *
 * Block-level boundaries become spaces so "<p>a</p><p>b</p>" reads "a b"
 * rather than "ab".
 */
export function toPlainText(html: string): string {
  if (!html) return "";

  let out = html
    // Treat block boundaries and line breaks as whitespace.
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\s*\/?>/gi, " ")
    // Drop everything else that looks like a tag.
    .replace(/<[^>]*>/g, "");

  // Decode entities. DOMParser handles the whole set; the manual fallback
  // covers the common ones for non-DOM environments.
  if (typeof DOMParser !== "undefined") {
    try {
      out =
        new DOMParser().parseFromString(out, "text/html").documentElement
          .textContent ?? out;
    } catch {
      /* fall through to the manual pass */
    }
  }
  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return out.replace(/\s+/g, " ").trim();
}

/** Plain-text preview for a notification body: flattened, then truncated. */
export function notificationPreview(html: string, maxLength = 100): string {
  const text = toPlainText(html);
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
}
