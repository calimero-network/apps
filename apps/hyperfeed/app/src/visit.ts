/**
 * Your last visit to a feed on this device, so the brief can say what
 * happened "since you were here". A visit is one stretch of use: coming back
 * after `VISIT_GAP_MS` away starts a new one, and the one before it is where
 * "since" starts. Kept in this browser only; with no storage, the brief falls
 * back to the start of today.
 */

/** How long away makes the next look a new visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

interface Visit {
  /** When you were last seen here. */
  at: number;
  /** When the visit before this one ended: where "since" starts; 0 for none. */
  prev: number;
}

const keyOf = (feed: string) => `hyperfeed:visit:${feed || "demo"}`;

function load(feed: string): Visit | null {
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(feed)) ?? "null") as Visit | null;
    return v && typeof v.at === "number" && typeof v.prev === "number" ? v : null;
  } catch {
    return null;
  }
}

function save(feed: string, v: Visit) {
  try {
    localStorage.setItem(keyOf(feed), JSON.stringify(v));
  } catch {
    // Private mode: "since" falls back to today.
  }
}

/**
 * Record that you are here now, and return where "since" starts: the end of
 * your previous visit, or 0 when this device has none.
 */
export function touchVisit(feed: string, now = Date.now()): number {
  const v = load(feed);
  const next: Visit = !v ? { at: now, prev: 0 } : now - v.at > VISIT_GAP_MS ? { at: now, prev: v.at } : { at: now, prev: v.prev };
  save(feed, next);
  return next.prev;
}
