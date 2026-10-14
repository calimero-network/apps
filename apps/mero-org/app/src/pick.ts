/** The org this tab works on, remembered across reloads. Shared by the picker (App.tsx) and the /join flow. */
export const PICK_KEY = "mero-org:context";
export interface OrgPick { contextId: string; namespaceId: string }

export function readPick(): OrgPick | null {
  try { const raw = localStorage.getItem(PICK_KEY); return raw ? (JSON.parse(raw) as OrgPick) : null; } catch { return null; }
}

/** Private mode throws on write; the pick then lives for this page load only. */
export function writePick(pick: OrgPick | null): void {
  try { if (pick) localStorage.setItem(PICK_KEY, JSON.stringify(pick)); else localStorage.removeItem(PICK_KEY); } catch { /* storage unavailable */ }
}
