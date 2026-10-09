/**
 * How an app key looks on screen.
 *
 * The contract stores a short app key per row (`chat`, `sign`, …), the same key
 * your per-app policy is filed under. Keys for the fleet's own apps get a fixed
 * name, monogram and colour; anything else is named after its key and given a
 * colour from the key, so the same app always looks the same.
 */
export interface AppLook {
  key: string;
  name: string;
  letters: string;
  color: string;
}

const KNOWN: Record<string, Omit<AppLook, "key">> = {
  chat: { name: "Chat", letters: "Ch", color: "#2f4be0" },
  sheets: { name: "Sheets", letters: "Sh", color: "#067647" },
  calendar: { name: "Calendar", letters: "Ca", color: "#6e2c91" },
  issues: { name: "Issues", letters: "Is", color: "#b54708" },
  crm: { name: "CRM", letters: "Cr", color: "#0e6a82" },
  sign: { name: "Sign", letters: "Si", color: "#8a4b08" },
  docs: { name: "Docs", letters: "Do", color: "#344054" },
  updates: { name: "Updates", letters: "Up", color: "#9e2a5c" },
  vote: { name: "Vote", letters: "Vo", color: "#4b4fb8" },
  pass: { name: "Pass", letters: "Pa", color: "#101318" },
  forum: { name: "Forum", letters: "Fo", color: "#5b3a29" },
  design: { name: "Design", letters: "De", color: "#a3245b" },
  stream: { name: "Stream", letters: "St", color: "#155e75" },
  chess: { name: "Chess", letters: "Cs", color: "#3f3f46" },
};

/** The apps the controls list even before anything has happened in them. */
export const DEFAULT_APPS = ["chat", "calendar", "sheets", "issues", "docs", "crm", "sign", "pass", "updates", "vote"];

/** Dark enough for white text (4.5:1) and told apart by lightness as well as hue. */
const PALETTE = ["#2f4be0", "#067647", "#6e2c91", "#b54708", "#0e6a82", "#9e2a5c", "#344054", "#4b4fb8"];

export function appLook(key: string): AppLook {
  const known = KNOWN[key];
  if (known) return { key, ...known };
  const name = key
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    key,
    name: name || key,
    letters: (name.replace(/\s/g, "").slice(0, 2) || "??").replace(/^./, (c) => c.toUpperCase()),
    color: PALETTE[hash % PALETTE.length] ?? "#344054",
  };
}

/**
 * The app key for an installed package: `com.calimero.mero-chat` → `chat`,
 * `com.example.notes` → `notes`. Keys must be lowercase letters, digits, `-` or
 * `.` and at most 40 bytes — the contract refuses anything else.
 */
export function appKeyForPackage(pkg: string | undefined, applicationId: string): string {
  const last = (pkg ?? "").split(".").pop() ?? "";
  const key = last
    .toLowerCase()
    .replace(/^mero-/, "")
    .replace(/[^a-z0-9.-]/g, "-")
    .slice(0, 40);
  return key || `app-${applicationId.slice(0, 8).toLowerCase()}`;
}
