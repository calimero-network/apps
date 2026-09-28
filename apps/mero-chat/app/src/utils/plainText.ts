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

/** How much of a message a notification needs: its text and attachment counts. */
export interface NotifiableMessage {
  text?: string | null;
  images?: ArrayLike<unknown> | null;
  files?: ArrayLike<unknown> | null;
}

/**
 * What a notification should say about `message`, or `""` when there is
 * nothing to announce.
 *
 * A message can be attachments alone, with no text. Its text flattens to
 * nothing, so it used to fail every `if (msg.text)` guard and nobody was
 * notified. Say what was sent instead: "Alice sent an image".
 *
 * Text, when there is any, is returned as-is (still HTML). The notify calls
 * flatten and truncate it, and the attachment sentence passes through that
 * unchanged.
 */
export function notificationBody(message: NotifiableMessage, senderName: string): string {
  const text = message.text ?? "";
  if (toPlainText(text)) return text;

  const hasImage = (message.images?.length ?? 0) > 0;
  const hasFile = (message.files?.length ?? 0) > 0;
  const sender = senderName || "Someone";
  if (hasImage && hasFile) return `${sender} sent an image and a file`;
  if (hasImage) return `${sender} sent an image`;
  if (hasFile) return `${sender} sent a file`;
  return "";
}
