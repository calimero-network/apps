/** Coalesce a burst of calls into one, `delayMs` after the last. */
export function debounce(fn: () => void, delayMs: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, delayMs);
  };
  kick.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return kick;
}
