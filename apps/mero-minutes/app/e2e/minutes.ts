/**
 * What Minutes' e2e shares: the virtual authenticator, and writing meetings
 * through the contract with the browser's own session, as the extension does.
 */
import { CalimeroClient } from "@calimero-network/mero-js";
import type { BrowserContext, Page } from "@playwright/test";

export const NODES = ["http://127.0.0.1:2501", "http://127.0.0.1:2502", "http://127.0.0.1:2503"];

/** Chromium's virtual authenticator: passkey ceremonies and step-ups answer without a prompt. */
export async function withPasskey(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

interface Stored {
  sessionKey: string;
  session: unknown;
  appId: string;
}

/** The page's session and open workspace, from its storage. */
async function stored(page: Page): Promise<Stored> {
  const all = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const sessionKey = Object.keys(all).find((k) => k.startsWith("calimero-session:mero-minutes"));
  const activeKey = Object.keys(all).find((k) => k.startsWith("mero-minutes:active"));
  if (!sessionKey || !activeKey) throw new Error(`no session or workspace in the page's storage: ${Object.keys(all).join(", ")}`);
  const active = JSON.parse(all[activeKey]!) as { appId: string };
  return { sessionKey, session: JSON.parse(all[sessionKey]!), appId: active.appId };
}

export interface Line {
  speaker: "you" | "others";
  text: string;
}

export interface Seeded {
  appId: string;
  /** Meeting ids by title. */
  ids: Record<string, string>;
}

/**
 * Writes `meetings` into the page's open workspace as the signed-in person,
 * then hands the (possibly renewed) session back to the page and reloads it:
 * a refresh token is single-use, so the page must carry on with the new one.
 */
export async function seedMeetings(
  page: Page,
  meetings: { title: string; platform: string; lines: Line[]; live?: boolean; summary?: string; actions?: { text: string; assignee: string; seq: number }[] }[],
): Promise<Seeded> {
  const s = await stored(page);
  const client = new CalimeroClient({ baseUrl: NODES[0]!, nodes: NODES.slice(1), policy: { allowMock: true } });
  client.useSession(s.session as Parameters<CalimeroClient["useSession"]>[0]);
  const call = async <T>(method: string, args: Record<string, unknown>): Promise<T> =>
    (await client.apps.call({ app: s.appId, method, args })).result as T;
  const ids: Record<string, string> = {};
  for (const m of meetings) {
    const id = await call<string>("startMeeting", { title: m.title, platform: m.platform, url: "", model: "moonshine-base", language: "en" });
    ids[m.title] = id;
    let t = 0;
    const segments = m.lines.map((l, seq) => {
      const d = 1_500 + l.text.length * 40;
      const seg = { seq, startMs: t, endMs: t + d, speaker: l.speaker, text: l.text };
      t += d + 500;
      return seg;
    });
    for (let i = 0; i < segments.length; i += 100) {
      await call("appendSegments", { meetingId: id, segments: segments.slice(i, i + 100) });
    }
    if (m.summary) await call("setSummary", { meetingId: id, summary: m.summary });
    for (const a of m.actions ?? []) await call("addAction", { meetingId: id, text: a.text, assignee: a.assignee, sourceSeq: a.seq });
    if (!m.live) await call("endMeeting", { meetingId: id, durationMs: t });
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [s.sessionKey, JSON.stringify(client.session)] as const);
  await page.reload();
  return { appId: s.appId, ids };
}
