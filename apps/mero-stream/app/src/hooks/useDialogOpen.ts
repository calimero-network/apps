import { useEffect, type RefObject } from "react";

/**
 * Keep a native `<dialog>` in sync with a React `open` boolean.
 *
 * The element has its own idea of openness and the two only agree if it is driven
 * through `showModal()`/`close()`. Setting the `open` ATTRIBUTE instead gives a
 * non-modal dialog: no backdrop, no focus trap, no Escape, no top layer — which
 * looks identical in a screenshot and is not the same thing at all.
 *
 * Extracted because this exact effect, and this exact reasoning, was
 * copy-pasted into three components. Any future change here — handling `close()`
 * throwing, waiting out a transition — now happens once.
 *
 * The caller still needs `onClose` on the element: Escape and a backdrop
 * dismissal close the dialog without going through React, so the `close` event is
 * the only way state finds out.
 */
export function useDialogOpen(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Guarded both ways: `showModal()` on an already-open dialog throws
    // InvalidStateError, and `close()` on a closed one fires a spurious `close`
    // event that would bounce straight back through `onClose`.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [ref, open]);
}
