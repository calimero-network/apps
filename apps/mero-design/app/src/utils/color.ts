/**
 * Whether a colour will actually paint anything.
 *
 * `el.stroke || "#000"` reads like a fallback but never fires: the stored value is
 * the *string* `"transparent"`, which is truthy. That is why lines drew invisibly
 * and why stroke silently did nothing on text and images. Every colour decision
 * goes through this instead of a truthiness check.
 */
export function isPaintable(colour: string | null | undefined): colour is string {
  if (!colour) return false;
  const c = colour.trim().toLowerCase();
  return c !== "" && c !== "transparent" && c !== "none" && c !== "rgba(0,0,0,0)";
}
