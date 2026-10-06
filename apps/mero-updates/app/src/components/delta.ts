/** Which way a "+12%" / "−4%" / "±0%" delta points. */
export function deltaDir(delta: string | null | undefined): "up" | "down" | "flat" {
  if (!delta) return "flat";
  return delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : "flat";
}
