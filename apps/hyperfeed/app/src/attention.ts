import type { FeedItem } from "./generated/HyperfeedClient";
import { headlineOf, line } from "./team";

/**
 * Alerts: when something starts needing you (your agent asks, an action waits
 * for your approval, an app flags you) while you are looking elsewhere, the
 * system says so once, with a banner, and the tab's title counts what waits.
 *
 * Everything here is a reading of the rows the feed already returns; nothing
 * new is stored on the node. Whether alerts are on is this browser's choice.
 */

/** One alert: what to say, and where a click takes you. */
export interface Alert {
  /** The banner's tag: a second alert for the same chain replaces the first. */
  chain: string;
  title: string;
  body: string;
  /** A question from your agent opens its chat; anything else, the feed. */
  opens: "chat" | "feed";
}

/** What needs you in a feed, keyed by row: a new row in a chain that waits is a new thing to say. */
export function waitingKeys(items: FeedItem[]): Set<string> {
  return new Set(items.filter((i) => i.needs_you).map((i) => `${i.chain}:${i.id}`));
}

/**
 * The rows that started needing you since `before`, as alerts. `before` null
 * is the first read: what already waited when you opened the feed is on the
 * screen, not news, so it says nothing.
 */
export function newAlerts(before: Set<string> | null, items: FeedItem[], appName: (key: string) => string): Alert[] {
  if (!before) return [];
  return items.filter((i) => i.needs_you && !before.has(`${i.chain}:${i.id}`)).map((i) => alertOf(i, appName));
}

export function alertOf(item: FeedItem, appName: (key: string) => string): Alert {
  const h = headlineOf(item, appName);
  const what = line(h.object || item.body || item.title, 140);
  if (item.kind === "message") {
    const prompt = line(item.ask?.prompt ?? "", 140);
    return { chain: item.chain, title: "Your agent asks you", body: prompt || what, opens: "chat" };
  }
  if (item.kind === "action") {
    return { chain: item.chain, title: "Approve?", body: line(item.title, 140) || what, opens: "feed" };
  }
  const sentence = `${h.who} ${h.verb}`.trim();
  return { chain: item.chain, title: `${appName(item.app)}: needs you`, body: what ? `${sentence} · ${what}` : sentence, opens: "feed" };
}

/** The tab's title: "(3) hyperfeed" while three things wait for you. */
export function tabTitle(waiting: number, base = "hyperfeed"): string {
  return waiting > 0 ? `(${waiting}) ${base}` : base;
}
