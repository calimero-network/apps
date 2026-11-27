/**
 * The shared dialogs (start a workspace, invite, join) close on Esc and ✕ but
 * not on a click outside them. This adds that, for all of them at once: a
 * press and a release both on the dimmed backdrop (`.mero-cw-overlay` itself,
 * not the card) presses the dialog's own ✕, so the dialog closes the way it
 * already knows how.
 */
export function closeSharedDialogsOnBackdrop(doc: Document = document): () => void {
  let pressed: EventTarget | null = null;
  const isBackdrop = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement && t.classList.contains("mero-cw-overlay");
  const down = (e: MouseEvent) => {
    pressed = e.target;
  };
  const click = (e: MouseEvent) => {
    const t = e.target;
    const both = isBackdrop(t) && pressed === t;
    pressed = null;
    if (!both) return;
    t.querySelector<HTMLButtonElement>(".mero-cw-x")?.click();
  };
  doc.addEventListener("mousedown", down, true);
  doc.addEventListener("click", click, true);
  return () => {
    doc.removeEventListener("mousedown", down, true);
    doc.removeEventListener("click", click, true);
  };
}
