/**
 * The service worker: signs in through the served page, starts and stops
 * recordings, and sends the transcript to the workspace. Capture and speech
 * recognition run in the offscreen document (a service worker has no media
 * or audio); the transcript queue lives here and in `chrome.storage.local`, so
 * a restarted worker carries on with what was waiting.
 */
import { pickWorkspaces, type AppRow } from "../lib/workspaces";
import { PACKAGE, meetingLink, servedPage } from "../lib/appHost";
import { newHandoff, openHandoff, signInUrl } from "../lib/handoff";
import {
  DEFAULT_SETTINGS,
  IDLE,
  KEYS,
  type AuthState,
  type Line,
  type OffscreenCommand,
  type OffscreenEvent,
  type RecorderStatus,
  type Reply,
  type Request,
  type Settings,
  type Workspace,
} from "../lib/messages";
import { detectPlatform, meetingTitle, meetingUrl } from "../lib/platform";
import { UploadQueue, type QueueState, type QueueStore, type QueuedSegment } from "../lib/queue";
import { describe, isSignedOut, withClient } from "../lib/session";
import { read, write } from "../lib/storage";
import { log } from "../lib/diagnostics";
import { resolveTier, TIERS, type Capabilities } from "../lib/tiers";

const OFFSCREEN = "offscreen.html";
const TRANSCRIPT_LIMIT = 5_000;

// ── state ────────────────────────────────────────────────────────────────────

const settings = async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...(await read<Settings>("local", KEYS.settings)) });
const auth = () => read<AuthState>("local", KEYS.auth);
const saveAuth = (a: AuthState | null) => write("local", KEYS.auth, a);
const status = async (): Promise<RecorderStatus> => (await read<RecorderStatus>("session", KEYS.status)) ?? IDLE;

let statusWrite: Promise<void> = Promise.resolve();
/** Status changes, one after the other (events arrive faster than storage writes). */
function setStatus(change: (s: RecorderStatus) => RecorderStatus): Promise<void> {
  statusWrite = statusWrite.then(async () => write("session", KEYS.status, change(await status())));
  return statusWrite;
}

const queueStore: QueueStore = {
  load: () => read<QueueState>("local", KEYS.queue),
  save: (s) => write("local", KEYS.queue, s),
};

/**
 * Every call to the node, one at a time, each with the session as the last
 * one left it: a refresh token works once, so two calls refreshing at the
 * same moment would sign the person out.
 */
let nodeLock: Promise<unknown> = Promise.resolve();
function onNode<T>(
  work: Parameters<typeof withClient<T>>[2],
  appId?: string,
): Promise<T> {
  const run = async () => {
    const a = await auth();
    if (!a) throw new Error("Sign in first.");
    const workspace = appId ? { appId, name: a.workspace?.name ?? "" } : a.workspace;
    try {
      return await withClient({ ...a, workspace }, async (next) => saveAuth({ ...next, workspace: a.workspace }), work);
    } catch (e) {
      if (isSignedOut(e)) await saveAuth(null);
      throw e;
    }
  };
  const result = nodeLock.then(run, run);
  nodeLock = result.catch(() => undefined);
  return result;
}

async function send(appId: string, meetingId: string, batch: QueuedSegment[]): Promise<void> {
  await onNode((_client, app) => app.appendSegments({ meetingId, segments: batch }), appId);
}

let queue: UploadQueue | null = null;
async function currentQueue(): Promise<UploadQueue | null> {
  queue ??= await UploadQueue.restore(queueStore, send);
  return queue;
}

async function flushQueue(force = false): Promise<void> {
  const q = await currentQueue();
  if (!q) return;
  await q.flush(force);
  const snap = q.snapshot;
  if (snap.lastError) await log(`upload: ${snap.pending.length} waiting, last error: ${snap.lastError}`);
  await setStatus((s) => ({ ...s, pending: snap.pending.length, uploadError: snap.lastError }));
}

// ── offscreen document ───────────────────────────────────────────────────────

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Record the meeting tab and microphone, keep the call audible, and transcribe speech on this device.",
  });
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

function toOffscreen<T = unknown>(command: OffscreenCommand): Promise<T> {
  return chrome.runtime.sendMessage(command) as Promise<T>;
}

// ── sign-in ──────────────────────────────────────────────────────────────────

async function signIn(): Promise<AuthState> {
  const s = await settings();
  const page = await servedPage(s.pageOverride);
  const request = await newHandoff();
  const url = signInUrl(page.origin, page.version, request);
  const answer = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!answer) throw new Error("Sign-in was cancelled.");
  const session = await openHandoff(request, answer);
  const previous = await auth();
  const next: AuthState = {
    accountId: session.accountId,
    session: {
      accountId: session.accountId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      refreshToken: session.refreshToken,
    },
    nodeUrl: session.nodeUrl,
    nodes: session.nodes,
    page,
    // The same account on the same page keeps its workspace.
    workspace: previous && previous.accountId === session.accountId ? previous.workspace : null,
  };
  await saveAuth(next);
  return next;
}

async function listWorkspaces(): Promise<Workspace[]> {
  const dev = (await settings()).pageOverride !== "";
  const { apps } = await onNode((client) => client.apps.list(dev ? {} : { package: PACKAGE }));
  return pickWorkspaces(apps as AppRow[], PACKAGE, dev);
}

// ── recording ────────────────────────────────────────────────────────────────

async function start(tabId: number): Promise<void> {
  const current = await status();
  if (current.phase === "recording" || current.phase === "starting" || current.phase === "loading-model")
    throw new Error("Already recording.");
  const a = await auth();
  if (!a) throw new Error("Sign in first.");
  if (!a.workspace) throw new Error("Choose a workspace first.");
  const workspace = a.workspace;
  const tab = await chrome.tabs.get(tabId);
  const s = await settings();
  const platform = detectPlatform(tab.url);
  const title = meetingTitle(tab.title, platform);

  await setStatus(() => ({ ...IDLE, phase: "starting" }));
  await write("session", KEYS.transcript, [] as Line[]);
  /** The meeting made for this recording, deleted again if capture never starts. */
  let meetingId: string | null = null;
  try {
    await ensureOffscreen();
    const caps = await toOffscreen<Capabilities>({ target: "offscreen", type: "caps" });
    const tier = resolveTier(s.tier, caps, s.language);
    await log(
      `start: platform=${platform} tier=${tier} choice=${s.tier} lang=${s.language || "auto"} mic=${s.mic} webgpu=${caps.webgpu} mem=${caps.deviceMemoryGb} cores=${caps.cores} cached=${(caps.cached ?? []).join(",") || "none"}`,
    );
    const id = await onNode((_c, app) =>
      app.startMeeting({
        title,
        platform,
        url: meetingUrl(tab.url),
        model: TIERS[tier].modelId,
        language: s.language,
      }),
    );
    meetingId = id;
    queue = await UploadQueue.start(workspace.appId, id, queueStore, send);
    recordingTab = tabId;
    await chrome.storage.session.set({ "minutes:tab": tabId });
    await setStatus((st) => ({
      ...st,
      phase: "loading-model",
      tier,
      meeting: { id, appId: workspace.appId, title, platform, startedAt: Date.now() },
    }));
    // A tab's stream id lives only a few seconds and is used once: ask for it
    // last, right before the offscreen page opens it.
    let streamId: string;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      await log(`tab capture refused: ${describe(e)}`);
      throw e;
    }
    await log("tab stream id taken, capturing");
    await toOffscreen({ target: "offscreen", type: "capture", streamId, mic: s.mic, tier, language: s.language });
  } catch (e) {
    await log(`start failed: ${describe(e)}`);
    // No audio can come: drop the empty meeting rather than leave it behind.
    if (meetingId) {
      const id = meetingId;
      await onNode((_c, app) => app.deleteMeeting({ meetingId: id }), workspace.appId).catch(() => undefined);
    }
    await queue?.clear();
    queue = null;
    recordingTab = null;
    await closeOffscreen().catch(() => undefined);
    await setStatus((st) => ({ ...st, phase: "error", error: describe(e), meeting: null }));
    throw e;
  }
}

let recordingTab: number | null = null;
let stopping: Promise<void> | null = null;

async function stop(): Promise<void> {
  const s = await status();
  if (s.phase !== "recording" && s.phase !== "loading-model") return;
  await setStatus((st) => ({ ...st, phase: "stopping" }));
  await log(`stop pressed (phase was ${s.phase})`);
  // The offscreen page transcribes what it still holds, then answers `drained`.
  await toOffscreen({ target: "offscreen", type: "stop" }).catch(async (e: unknown) => {
    await log(`stop: offscreen page did not answer: ${describe(e)}`);
    await finish(0);
  });
}

/**
 * The tab could not be recorded: nothing was captured, so the meeting just made
 * is deleted (not left empty in the list) and the popup shows why.
 */
async function abandon(message: string): Promise<void> {
  const s = await status();
  const meeting = s.meeting;
  if (meeting) await onNode((_c, app) => app.deleteMeeting({ meetingId: meeting.id }), meeting.appId).catch(() => undefined);
  const q = await currentQueue();
  if (q) await q.clear();
  queue = null;
  recordingTab = null;
  await closeOffscreen().catch(() => undefined);
  await setStatus((st) => ({ ...st, phase: "error", error: message, meeting: null, link: null }));
}

/** Everything transcribed: send the rest, end the meeting, close the offscreen page. */
function finish(durationMs: number): Promise<void> {
  stopping ??= (async () => {
    const s = await status();
    const q = await currentQueue();
    const all = q ? await q.drain() : true;
    let link: string | null = null;
    let error: string | null = null;
    const a = await auth();
    const meeting = s.meeting;
    if (a && meeting) {
      try {
        await onNode(
          (_c, app) => app.endMeeting({ meetingId: meeting.id, durationMs: Math.min(durationMs, 0xffffffff) }),
          meeting.appId,
        );
      } catch (e) {
        error = describe(e);
      }
      link = meetingLink(a.page, meeting.appId, meeting.id);
    }
    await log(`finish: duration=${durationMs}ms uploaded=${all} pending=${q?.pending ?? 0} error=${error ?? "none"}`);
    if (all && q) await q.clear();
    queue = all ? null : q;
    recordingTab = null;
    await closeOffscreen().catch(() => undefined);
    await setStatus((st) => ({
      ...st,
      phase: "saved",
      link,
      pending: q && !all ? q.pending : 0,
      uploadError: all ? null : "Some lines are still waiting to be saved; they will be sent when you are back online.",
      error: error ?? st.error,
    }));
  })().finally(() => {
    stopping = null;
  });
  return stopping;
}

// ── events from the offscreen page ───────────────────────────────────────────

async function onOffscreen(event: OffscreenEvent): Promise<void> {
  if (event.type === "segment") await log(`segment: ${event.speaker} ${event.startMs}-${event.endMs}ms, ${event.text.length} chars`);
  else if (event.type === "model" && event.state !== "loading") await log(`model ${event.tier}: ${event.state}${event.error ? ` (${event.error})` : ""}`);
  else if (event.type === "stepDown") await log(`step down: ${event.from} -> ${event.to}`);
  else if (event.type === "notice" || event.type === "captureError" || event.type === "log") await log(`${event.type}: ${event.message}`);
  else if (event.type === "drained") await log(`drained: ${event.durationMs}ms`);
  switch (event.type) {
    case "segment": {
      const q = await currentQueue();
      if (!q) return;
      await q.add({ speaker: event.speaker, startMs: event.startMs, endMs: event.endMs, text: event.text });
      const line: Line = { speaker: event.speaker, text: event.text.trim(), startMs: event.startMs };
      const lines = (await read<Line[]>("session", KEYS.transcript)) ?? [];
      lines.push(line);
      await write("session", KEYS.transcript, lines.slice(-TRANSCRIPT_LIMIT));
      await setStatus((s) => ({ ...s, lines: [...s.lines, line].slice(-6) }));
      await flushQueue();
      return;
    }
    case "tick":
      await flushQueue();
      return;
    case "model":
      await setStatus((s) => ({
        ...s,
        tier: event.tier,
        model: event.state === "loading" ? (event.progress ?? { fraction: 0, file: "" }) : null,
        phase: event.state === "ready" && s.phase === "loading-model" ? "recording" : s.phase,
        error: event.state === "error" ? (event.error ?? "The speech model could not load.") : s.error,
      }));
      return;
    case "stepDown":
      await setStatus((s) => ({
        ...s,
        tier: event.to,
        notice: `Switched to ${TIERS[event.to].name} to keep up with the conversation.`,
      }));
      return;
    case "notice":
      await setStatus((s) => ({ ...s, notice: event.message }));
      return;
    case "captureError":
      await abandon(event.message);
      return;
    case "log":
      return;
    case "drained":
      await finish(event.durationMs);
      return;
    case "levels":
      return;
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────

let offscreenEvents: Promise<unknown> = Promise.resolve();

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case "signIn":
      return signIn();
    case "signOut":
      await saveAuth(null);
      return null;
    case "listWorkspaces":
      return listWorkspaces();
    case "chooseWorkspace": {
      const a = await auth();
      if (!a) throw new Error("Sign in first.");
      await saveAuth({ ...a, workspace: req.workspace });
      return null;
    }
    case "start":
      return start(req.tabId);
    case "stop":
      return stop();
    case "dismiss":
      await setStatus(() => IDLE);
      return null;
    case "preload":
      await ensureOffscreen();
      return toOffscreen({ target: "offscreen", type: "preload", tier: req.tier });
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const m = message as Partial<OffscreenEvent> & Partial<OffscreenCommand> & { type?: string };
  if (m.target === "offscreen") return false;
  if (m.source === "offscreen") {
    const e = message as OffscreenEvent;
    // Levels are for the popup. Everything else is handled in the order it was
    // sent: a burst of segments keeps every line, and `drained` comes after the
    // segments before it are queued.
    if (e.type !== "levels") {
      offscreenEvents = offscreenEvents.then(() => onOffscreen(e)).catch((err: unknown) => log(`event ${e.type} failed: ${describe(err)}`));
    }
    return false;
  }
  if (sender.id !== chrome.runtime.id) return false;
  handle(message as Request).then(
    (value) => respond({ ok: true, value } satisfies Reply),
    (e: unknown) => respond({ ok: false, error: describe(e) } satisfies Reply),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const tab = recordingTab ?? ((await chrome.storage.session.get("minutes:tab"))["minutes:tab"] as number | undefined);
    if (tab === tabId) await stop();
  })();
});

// A restarted worker sends what was waiting.
chrome.runtime.onStartup.addListener(() => void flushQueue(true));
