/** Which call a tab holds, and a title for its meeting. */
export type Platform = "meet" | "zoom" | "teams" | "other";

export const PLATFORM_NAMES: Record<Platform, string> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  other: "Browser tab",
};

export function detectPlatform(url: string | undefined | null): Platform {
  if (!url) return "other";
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return "other";
  }
  if (host === "meet.google.com") return "meet";
  if (host === "zoom.us" || host.endsWith(".zoom.us") || host === "app.zoom.us") return "zoom";
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com"))
    return "teams";
  if (host === "teams.cloud.microsoft") return "teams";
  void path;
  return "other";
}

/** Whether the tab is in a call (not the platform's lobby or home page). */
export function isInCall(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  switch (detectPlatform(url)) {
    case "meet":
      return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(u.pathname);
    case "zoom":
      return /\/wc\/|\/j\/|\/s\//.test(u.pathname);
    case "teams":
      return true;
    default:
      return false;
  }
}

const SUFFIXES = [/\s*[-–|]\s*Google Meet$/i, /\s*[-–|]\s*Zoom( Meeting)?$/i, /\s*[-–|]\s*Microsoft Teams$/i, /^Meet\s*[-–]\s*/i];

/** A meeting title from a tab title: the platform's suffix dropped, a dated fallback when nothing is left. */
export function meetingTitle(tabTitle: string | undefined | null, platform: Platform, now: Date = new Date()): string {
  let t = (tabTitle ?? "").trim();
  for (const s of SUFFIXES) t = t.replace(s, "").trim();
  // Meet's lobby and call titles that are only a code say nothing.
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(t)) t = "";
  if (/^(Zoom( Meeting| Workplace)?|Google Meet|Microsoft Teams|Meet)$/i.test(t)) t = "";
  if (t) return t.slice(0, 200);
  const when = now.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${platform === "other" ? "Call" : `${PLATFORM_NAMES[platform]} call`} · ${when}`;
}

/** The address kept with the meeting: https only, without query or fragment (they may carry passcodes). */
export function meetingUrl(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return "";
    return `${u.origin}${u.pathname}`.slice(0, 2000);
  } catch {
    return "";
  }
}
