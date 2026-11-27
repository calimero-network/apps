/**
 * The extension e2e harness: the built extension in Chromium, a stand-in
 * Sylence page that completes the sign-in handoff the way the served page
 * does, a stand-in call tab, and a fake offscreen page (the real one needs a
 * tab stream, which Chrome hands out only after a toolbar click).
 */
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DIST = join(import.meta.dirname, "..", "dist");
export const ID = readFileSync(join(import.meta.dirname, "..", "extension-id.txt"), "utf8").trim();
export const CALLBACK = `https://${ID}.chromiumapp.org/`;
export const MEET_URL = "https://meet.google.com/abc-defg-hij";

export async function launch(): Promise<{ context: BrowserContext; worker: Worker }> {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "sylence-flows-")), {
    channel: "chromium",
    // No viewport emulation: Playwright would size every new window, the
    // sign-in popup included, to it. A desktop-sized screen for headless.
    viewport: null,
    args: ["--screen-info={1600x1000}", `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  // The stand-in call: a Google Meet address, so the popup names the platform.
  await context.route(`${MEET_URL}*`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Meet - Weekly sync</title><h1>Weekly sync</h1>" }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, worker };
}

/** The service worker, again: Chrome may have stopped and restarted it. */
export async function serviceWorker(context: BrowserContext): Promise<Worker> {
  const live = context.serviceWorkers().find((w) => w.url().includes(ID));
  if (live) return live;
  // Any extension page wakes it.
  const p = await context.newPage();
  await p.goto(`chrome-extension://${ID}/popup.html`);
  const w = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await p.close();
  return w;
}

/** The stand-in Sylence page: `/` reads the handoff from the fragment; `handoff(session)` seals it as the real page does. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Sylence (stand-in)</title>
<h1>Sign in to the Sylence extension</h1>
<script>
const EXT = ${JSON.stringify(ID)};
const parts = location.hash.replace(/^#/, "").split("&");
const params = new URLSearchParams(parts.slice(1).join("&"));
window.__req = { fragment: parts[0], state: params.get("state"), key: params.get("key"), intent: params.get("intent") };
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
window.handoff = async (session) => {
  const { state, key } = window.__req;
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const theirs = await crypto.subtle.importKey("raw", unb64u(key), ECDH, false, []);
  const mine = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine.privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("calimero.native-sign-in.v1") },
    hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(state) }, aes,
    new TextEncoder().encode(JSON.stringify(session)));
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", mine.publicKey));
  const box = new Uint8Array(epk.length + iv.length + sealed.byteLength);
  box.set(epk, 0); box.set(iv, epk.length); box.set(new Uint8Array(sealed), epk.length + iv.length);
  location.href = "https://" + EXT + ".chromiumapp.org/signed-in#state=" + state + "&box=" + b64u(box);
};
window.cancel = () => { location.href = "https://" + EXT + ".chromiumapp.org/signed-in#cancelled=1"; };
</script>`;

export async function startPage(): Promise<{ origin: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://localhost:${port}`, server };
}

export async function setStorage(worker: Worker, area: "local" | "session", items: Record<string, unknown>): Promise<void> {
  await worker.evaluate(([a, i]) => chrome.storage[a as "local" | "session"].set(i as Record<string, unknown>), [area, items] as const);
}

export async function getStorage<T = unknown>(worker: Worker, area: "local" | "session", key: string): Promise<T> {
  return (await worker.evaluate(
    async ([a, k]) => (await chrome.storage[a as "local" | "session"].get(k))[k],
    [area, key] as const,
  )) as T;
}

/** The popup as a tab, with "the active tab" answered as `tab` (the popup's own tab otherwise). */
export async function openPopup(context: BrowserContext, tab?: { id: number; url: string; title: string }): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  if (tab) {
    await page.addInitScript((t) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (q: chrome.tabs.QueryInfo) =>
        q?.active ? [{ ...t, active: true, windowId: 1, index: 0 }] : query(q)) as typeof chrome.tabs.query;
    }, tab);
  }
  await page.goto(`chrome-extension://${ID}/popup.html`);
  return page;
}

/** The sign-in windows the extension has open: their type, size and page address. */
export async function authWindows(worker: Worker): Promise<{ id: number; type: string; width: number; height: number; url: string }[]> {
  return worker.evaluate(async () => {
    const all = await chrome.windows.getAll({ populate: true });
    return all
      .filter((w) => w.type === "popup")
      .map((w) => ({
        id: w.id!,
        type: w.type!,
        width: w.width ?? 0,
        height: w.height ?? 0,
        url: w.tabs?.[0]?.pendingUrl || w.tabs?.[0]?.url || "",
      }));
  });
}

/**
 * Replaces the offscreen page: the service worker's offscreen calls become
 * no-ops and its tab stream id a fake one, and `control` (an extension page)
 * answers the offscreen commands as the real page would. Events the test
 * sends from `control` reach the service worker as the offscreen page's.
 */
export async function fakeOffscreen(context: BrowserContext): Promise<Page> {
  const worker = await serviceWorker(context);
  await worker.evaluate(() => {
    const g = chrome as unknown as {
      offscreen: { createDocument: unknown; closeDocument: unknown };
      tabCapture: { getMediaStreamId: unknown };
    };
    g.offscreen.createDocument = async () => undefined;
    g.offscreen.closeDocument = async () => undefined;
    g.tabCapture.getMediaStreamId = async () => "fake-stream";
  });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${ID}/sidepanel.html`);
  await control.evaluate(() => {
    const w = window as unknown as { __commands: string[]; __durationMs: number };
    w.__commands = [];
    w.__durationMs = 0;
    const emit = (e: Record<string, unknown>) => chrome.runtime.sendMessage({ ...e, source: "offscreen" });
    chrome.runtime.onMessage.addListener((m: { target?: string; type?: string; tier?: string }, _s, respond) => {
      if (m.target !== "offscreen") return false;
      w.__commands.push(m.type!);
      if (m.type === "caps") respond({ webgpu: false, maxBufferSize: 0, deviceMemoryGb: 8, cores: 8, cached: ["ultralight"] });
      else if (m.type === "capture") {
        respond(true);
        setTimeout(() => void emit({ type: "model", tier: m.tier, state: "ready" }), 50);
      } else if (m.type === "stop") {
        respond(true);
        setTimeout(() => void emit({ type: "drained", durationMs: w.__durationMs }), 50);
      } else respond(true);
      return false;
    });
  });
  return control;
}

/** A line "transcribed" by the fake offscreen page. */
export async function say(control: Page, speaker: "you" | "others", startMs: number, text: string): Promise<void> {
  await control.evaluate(
    ([sp, st, t]) => {
      (window as unknown as { __durationMs: number }).__durationMs = (st as number) + 3_000;
      return chrome.runtime.sendMessage({ source: "offscreen", type: "segment", speaker: sp, startMs: st, endMs: (st as number) + 2_500, text: t });
    },
    [speaker, startMs, text] as const,
  );
}
