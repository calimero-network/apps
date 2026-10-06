import { useEffect } from "react";

/** Focuses a field after mount, so a screenshot shows what focusing opens. */
export default function FocusField({ label }: { label: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      document
        .querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
        ?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [label]);
  return null;
}
