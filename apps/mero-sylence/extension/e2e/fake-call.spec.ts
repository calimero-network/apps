/**
 * A fake call, end to end (`pnpm e2e:call`; macOS, a local node, downloads a
 * speech model): four people with four voices talk through a script on a
 * stand-in Meet (tiles, then captions), Zoom and Teams page. The built
 * extension records it for real: its own offscreen page and speech model,
 * the speaker reader injected into the call page, the service worker naming
 * lines and saving them to a `merod local` node, the second pass after the
 * call when the browser has WebGPU, action items.
 *
 * Only the two audio sources are stood in for, since Chrome hands out a tab's
 * stream only after a click on the toolbar: the offscreen page (opened as a
 * tab) gets the call's mix as "the tab" and the recorder's voice, with the
 * call leaking into it, as "the microphone".
 *
 * Each run writes e2e/.fake-call/report-<platform>.md: every saved line, who
 * said it in the script and who the transcript says said it.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL_URLS, DIR, PEOPLE, SCRIPT, callPage, canSpeak, makeCall, report, score, type Call, type FakePlatform, type Saved } from "./fakeCall";
import { DIST, ID, getStorage, openPopup, serviceWorker, setStorage } from "./harness";
import { seed, unavailable, type Seeded } from "./node";

test.describe.configure({ mode: "serial" });

const PLATFORMS = ((process.env.SYLENCE_CALL_PLATFORMS ?? "meet,meet-captions,zoom,teams").split(",") as FakePlatform[]).filter(
  (p) => p in CALL_URLS,
);
const TIER = process.env.SYLENCE_CALL_TIER ?? "balanced";
const ME = PEOPLE.find((p) => p.me)!.name;
/** Watch it: visible windows (the call, Sylence's side panel, the saved meeting), every voice audible, left open at the end. */
const WATCH = process.env.SYLENCE_CALL_WATCH === "1";

let context: BrowserContext;
let node: Seeded | null = null;
let call: Call;
let audio: Server;
let offscreen: Page;
let control: Page;
let webgpu = false;

interface Status {
  phase: string;
  link?: string | null;
  meeting: { id: string; appId: string } | null;
  actions?: number;
  improved?: { done: boolean; why?: string } | null;
  error: string | null;
  tier: string | null;
}

test.beforeAll(async () => {
  test.skip(!process.env.SYLENCE_FAKE_CALL, "run with pnpm e2e:call");
  test.skip(!canSpeak(), "needs macOS `say` for the voices");
  const why = await unavailable();
  test.skip(!!why, why ?? "");
  test.setTimeout(600_000);

  call = makeCall();
  node = await seed();

  audio = createServer((req, res) => {
    const file = req.url?.startsWith("/mic") ? call.micWav : call.callWav;
    res.writeHead(200, { "content-type": "audio/wav", "access-control-allow-origin": "*" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => audio.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(audio.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "sylence-call-")), {
    channel: "chromium",
    headless: !WATCH && process.env.SYLENCE_CALL_HEADED !== "1",
    viewport: null,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-webgpu",
    ],
  });
  // The tutorial opens by itself on a first sign-in; these runs are past it.
  await context.addInitScript(() => localStorage.setItem("mero-sylence:tutorial-seen", "1"));
  for (const p of Object.keys(CALL_URLS) as FakePlatform[]) {
    await context.route(`${CALL_URLS[p].url}*`, (route) => route.fulfill({ contentType: "text/html", body: callPage(p) }));
  }

  // The service worker: no offscreen document of its own (the tab below is
  // one), and a stand-in tab stream id.
  const worker = await serviceWorker(context);
  await patchWorker(worker);

  // The offscreen page as a tab: the call's mix as "the tab", the recorder's
  // voice (and the call's leak) as "the microphone", both from the call's start.
  offscreen = await context.newPage();
  await offscreen.addInitScript(([b, w2]: [string, boolean]) => {
    const w = window as unknown as { __t0: number };
    const ctx = new AudioContext({ sampleRate: 48_000 });
    const play = async (url: string, fromSec: number, mark: boolean) => {
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const out = ctx.createMediaStreamDestination();
      src.connect(out);
      // Watching: the recorder's own voice is heard too (the call's is played back by Sylence).
      if (!mark && (window as unknown as { __watch?: boolean }).__watch) src.connect(ctx.destination);
      await ctx.resume();
      src.start(0, Math.max(0, fromSec));
      if (mark) w.__t0 = Date.now();
      return out.stream;
    };
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (JSON.stringify(c?.audio ?? "").includes("chromeMediaSource")) return play(`${b}/call.wav?${Date.now()}`, 0, true);
      return play(`${b}/mic.wav?${Date.now()}`, (Date.now() - w.__t0) / 1000, false);
    };
    (window as unknown as { __watch?: boolean }).__watch = w2;
  }, [base, WATCH] as [string, boolean]);
  await offscreen.goto(`chrome-extension://${ID}/offscreen.html`);

  control = await context.newPage();
  await control.goto(`chrome-extension://${ID}/sidepanel.html`);
  await control.evaluate(() => {
    const w = window as unknown as { __events: Record<string, unknown>[] };
    w.__events = [];
    chrome.runtime.onMessage.addListener((m: Record<string, unknown>) => {
      if (m.source === "offscreen" && m.type !== "levels") w.__events.push(m);
    });
  });
  const caps = (await control.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "caps" }))) as { webgpu: boolean };
  webgpu = !!caps?.webgpu;
  console.log(`fake call: ${SCRIPT.length} lines, ${(call.durationMs / 1000).toFixed(0)} s; live model ${TIER}; WebGPU ${webgpu ? "yes (second pass runs)" : "no (second pass skipped)"}`);

  // The recorder's name in the org, as they'd set it on the Sylence page: Zoom and Teams never say who "you" are.
  await node.person.client.orgs.memberMetadata({ org: node.org, account: node.person.accountId, metadata: { name: ME } });
  const session = await node.session();
  const workspace = node.workspaces[0]!;
  await setStorage(worker, "local", {
    "sylence:settings": {
      tier: TIER,
      language: "en",
      mic: true,
      pageOverride: "http://localhost:5173",
      autoActions: true,
      smartNotes: false,
      notesModel: "auto",
      speakerNames: true,
      improveAfterCall: true,
    },
    "sylence:auth": {
      accountId: session.accountId,
      session: { accountId: session.accountId, sessionToken: session.sessionToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken },
      nodeUrl: session.nodeUrl,
      nodes: session.nodes,
      page: { origin: "http://localhost:5173", version: null },
      workspace,
    },
  });

  // Load the live model before the call, as a person would wait for "Ready".
  await control.evaluate((tier) => chrome.runtime.sendMessage({ type: "preload", tier }), TIER);
  await expect
    .poll(() => control.evaluate(() => (window as unknown as { __events: { type: string; state?: string }[] }).__events.some((e) => e.type === "model" && e.state === "ready")), {
      timeout: 300_000,
      intervals: [2_000],
    })
    .toBe(true);
});

test.afterAll(async () => {
  if (WATCH && context && process.env.SYLENCE_CALL_NOWAIT !== "1") {
    console.log("\nThe browser stays open: close it to finish.");
    await new Promise<void>((r) => context.on("close", () => r()));
  }
  await context?.close();
  audio?.close();
  node?.stop();
});

async function patchWorker(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const g = chrome as unknown as {
      offscreen: { createDocument: unknown; closeDocument: unknown };
      tabCapture: { getMediaStreamId: unknown };
    };
    g.offscreen.createDocument = async () => undefined;
    g.offscreen.closeDocument = async () => undefined;
    g.tabCapture.getMediaStreamId = async () => "fake-call";
  });
}

/** A new browser window, empty, as a page this test drives. */
async function windowPage(worker: Worker, mark: string, bounds: chrome.windows.CreateData): Promise<Page> {
  const opened = context.waitForEvent("page", { predicate: (p) => p.url().endsWith(`#sylence-${mark}`) });
  await worker.evaluate(([b, m]) => chrome.windows.create({ ...(b as chrome.windows.CreateData), url: `about:blank#sylence-${m}` }), [bounds, mark] as const);
  return opened;
}

async function status(): Promise<Status> {
  return getStorage<Status>(await serviceWorker(context), "session", "sylence:status");
}

for (const platform of PLATFORMS) {
  test(`${platform}: who said what`, async () => {
    test.setTimeout(1_200_000);
    const { url, title } = CALL_URLS[platform];
    const worker = await serviceWorker(context);
    let page: Page;
    let popup!: Page;
    if (WATCH) {
      // Windows side by side: the call, and Sylence's live transcript; the
      // popup that presses Record in a small one of its own, so the call stays
      // the visible tab. Each opens empty and is navigated from here: a window
      // the extension opens on an address would skip the stand-in call page.
      page = await windowPage(worker, "call", { left: 0, top: 0, width: 960, height: 760, focused: true });
      await page.goto(url);
      const panel = await windowPage(worker, "panel", { type: "popup", left: 970, top: 0, width: 420, height: 760 });
      await panel.goto(`chrome-extension://${ID}/sidepanel.html`);
      popup = await windowPage(worker, "popup", { type: "popup", left: 970, top: 780, width: 420, height: 200 });
    } else {
      page = await context.newPage();
      await page.goto(url);
    }
    await page.waitForLoadState();
    await patchWorker(worker);
    const tabId = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u))!.id!, url);

    if (WATCH) {
      await popup.addInitScript((t) => {
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = (async (q: chrome.tabs.QueryInfo) =>
          q?.active ? [{ ...t, active: true, windowId: 1, index: 0 }] : query(q)) as typeof chrome.tabs.query;
      }, { id: tabId, url, title });
      await popup.goto(`chrome-extension://${ID}/popup.html`);
    } else {
      popup = await openPopup(context, { id: tabId, url, title });
    }
    await offscreen.evaluate(() => ((window as unknown as { __t0: number }).__t0 = 0));
    await popup.getByRole("button", { name: "Record meeting" }).click();
    await expect.poll(() => offscreen.evaluate(() => (window as unknown as { __t0: number }).__t0), { timeout: 30_000 }).toBeGreaterThan(0);
    const t0 = await offscreen.evaluate(() => (window as unknown as { __t0: number }).__t0);
    await page.evaluate(([t, lines]) => (window as unknown as { __play: (t: number, l: unknown) => void }).__play(t as number, lines), [t0, call.lines] as const);

    // The call plays out; then Stop.
    await page.waitForTimeout(Math.max(0, t0 + call.durationMs - Date.now()) + 1_000);
    // What the side panel showed during the call (before the second pass replaces it).
    const live = await getStorage<{ speaker: string; name?: string; text: string; startMs: number }[]>(await serviceWorker(context), "session", "sylence:transcript");
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "stop" }));
    await expect.poll(async () => (await status()).phase, { timeout: 1_100_000, intervals: [3_000] }).toBe("saved");
    const st = await status();
    expect(st.error).toBeNull();

    const meeting = st.meeting!;
    const page1 = await node!.view<{ segments: Saved[] }>(meeting.appId, "transcript", { meetingId: meeting.id, fromSeq: 0, limit: 500 });
    const actions = await node!.view<{ text: string; assignee: string }[]>(meeting.appId, "listActions", { meetingId: meeting.id });
    const m = await node!.view<{ platform: string; revised: boolean }>(meeting.appId, "getMeeting", { meetingId: meeting.id });
    const speakers = await getStorage<{ timeline: unknown[] }>(await serviceWorker(context), "session", "sylence:speakers");

    const { rows, found, missed } = score(page1.segments, call.lines, ME);
    const liveScore = score(
      (live ?? []).map((l, i) => ({ seq: i, speaker: l.speaker, name: l.name ?? "", startMs: l.startMs, text: l.text })),
      call.lines,
      ME,
    );
    const liveMatched = liveScore.rows.filter((r) => r.line);
    const matched = rows.filter((r) => r.line);
    const right = matched.filter((r) => r.right);
    const echoes = rows.filter((r) => r.saved.speaker === "you" && r.line && !r.line.me && r.score >= 0.6);
    const lines = [
      `Platform: ${m.platform} · live model: ${st.tier ?? TIER} · second pass: ${st.improved ? (st.improved.done ? "done" : `skipped (${st.improved.why})`) : "off"} · revised: ${m.revised}`,
      `Script lines heard: ${found.length}/${call.lines.length} · saved lines matched: ${matched.length}/${rows.length} · named right: ${right.length}/${matched.length}`,
      `Live (side panel, during the call): ${liveScore.rows.length} lines, named right ${liveMatched.filter((r) => r.right).length}/${liveMatched.length}; shown as: ${[...new Set(liveScore.rows.map((r) => r.shown))].join(", ")}`,
      `Echo lines under "You": ${echoes.length} · speaker changes the reader saw: ${speakers?.timeline?.length ?? 0}`,
      `Action items: ${actions.map((a) => `${a.text}${a.assignee ? ` (${a.assignee})` : ""}`).join("; ") || "none"}`,
    ];
    const md = report(platform, rows, missed, lines);
    writeFileSync(join(DIR, `report-${platform}.md`), md);
    console.log(`\n${md}\n`);

    expect(m.platform).toBe(platform.startsWith("meet") ? "meet" : platform);
    // The speech model heard most of the script…
    expect(found.length / call.lines.length).toBeGreaterThanOrEqual(0.75);
    // …the lines are given to the person who said them…
    expect(right.length / Math.max(1, matched.length)).toBeGreaterThanOrEqual(0.8);
    // …the call leaking into the mic is not saved as the recorder's words…
    expect(echoes).toEqual([]);
    // …and the request in the call became an action item.
    expect(actions.some((a) => /deck/i.test(a.text))).toBe(true);

    if (WATCH) {
      // The saved meeting on the Sylence page, signed in as the test account (its passkey in this browser).
      const link = (await status()).link ?? `http://localhost:5173/#/w/${meeting.appId}/m/${meeting.id}`;
      const meetingPage = await windowPage(worker, "meeting", { left: 120, top: 60, width: 1200, height: 820, focused: true });
      const cdp = await context.newCDPSession(meetingPage);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      })) as { authenticatorId: string };
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: await node!.person.passkey.toBrowser() });
      await meetingPage.goto(link);
      console.log(`The saved meeting: ${link} (sign in: the passkey is in this browser)`);
    }
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "dismiss" }));
    await popup.close();
    if (!WATCH) await page.close();
  });
}
