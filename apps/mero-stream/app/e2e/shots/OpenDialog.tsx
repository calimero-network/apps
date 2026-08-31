import { useEffect } from "react";

/**
 * Clicks a control after mount, so a screenshot can capture what it opens.
 *
 * Driving the real control rather than rendering the dialog directly: the
 * showModal() path is what a user gets (backdrop, top layer, focus trap), and a
 * screenshot of the non-modal fallback would not be the thing being documented.
 */
export default function OpenDialog({ testId }: { testId: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
        ?.click();
    }, 120);
    return () => clearTimeout(t);
  }, [testId]);
  return null;
}
