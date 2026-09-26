// Copy a secret, then take it back.
//
// A password left on the clipboard outlives the vault being locked, the tab
// being closed and the screen being shared. So every copy of a secret value
// schedules a clear. Before clearing, the clipboard is read back where the
// browser allows it, so something the user copied in the meantime is not
// wiped; where reading is refused, the clear happens anyway — losing an
// unrelated clipboard entry is the lesser harm.

export const CLIPBOARD_CLEAR_MS = 30_000;

let pending: ReturnType<typeof setTimeout> | null = null;

export async function copySecret(
  value: string,
  clearAfterMs = CLIPBOARD_CLEAR_MS,
): Promise<void> {
  await navigator.clipboard.writeText(value);
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void (async () => {
      try {
        const now = await navigator.clipboard.readText();
        if (now !== value) return;
      } catch {
        // Read refused (no permission, or the tab is not focused): clear anyway.
      }
      await navigator.clipboard.writeText('').catch(() => {});
    })();
  }, clearAfterMs);
}
