/**
 * The service worker: signs in through the served page, starts and stops
 * recordings, and sends the transcript to the workspace. Capture and speech
 * recognition run in the offscreen document (a service worker has no media
 * or audio); the transcript queue lives here and in `chrome.storage.local`, so
 * a restarted worker carries on with what was waiting.
 */
import { pickWorkspaces, type AppRow } from "../lib/workspaces";
import { PACKAGE, meetingLink, servedPage, isLocalPage } from "../lib/appHost";
import { findActions, type TranscriptLine } from "../lib/actionItems";
import { actionsToAdd, notesModelFor, type Notes, type NotesModelId } from "../lib/notes";
import { openAuthWindow, focusAuthWindow } from "../lib/authWindow";
import { newHandoff, openHandoff, signInUrl, type SignInIntent, type NewWorkspace } from "../lib/handoff";
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
  type SpeakersEvent,
  type Workspace,
} from "../lib/messages";
import { detectPlatform, meetingTitle, meetingUrl } from "../lib/platform";
import { UploadQueue, type QueueState, type QueueStore, type QueuedSegment } from "../lib/queue";
import { describe, isSignedOut, withClient } from "../lib/session";
import { read, write } from "../lib/storage";
import { log } from "../lib/diagnostics";
import { resolveTier, TIERS, type Capabilities, canImproveAfterCall, tierBlock } from "../lib/tiers";
import { nameFor, pushChange, type SpeakerChange } from "../lib/speakers";

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
      if (isSignedOut(e)) {
        await saveAuth(null);
        await write("session", KEYS.signedOutReason, "Your session ended or the account no longer exists. Sign in again.");
      }
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

// ── speaker names ────────────────────────────────────────────────────────────

/** Who talked when in the recording, from the call page's reader (src/content/speakers.ts). */
interface SpeakerState {
  tab: number | null;
  timeline: SpeakerChange[];
  participants: string[];
  self: string | null;
  /** The recorder's name in the workspace's organization: names their lines when the call page doesn't say who they are. */
  me?: string | null;
}
const NO_SPEAKERS: SpeakerState = { tab: null, timeline: [], participants: [], self: null, me: null };
/** Changes kept: lines are named within minutes of being spoken, even when transcription lags. */
const TIMELINE_LIMIT = 5_000;
let speakerState: SpeakerState | null = null;

async function speakers(): Promise<SpeakerState> {
  speakerState ??= (await read<SpeakerState>("session", KEYS.speakers)) ?? { ...NO_SPEAKERS };
  return speakerState;
}

async function saveSpeakers(next: SpeakerState): Promise<void> {
  speakerState = next;
  await write("session", KEYS.speakers, next);
}

/**
 * The name the recorder goes by in the workspace's organization (the name
 * they set on the Sylence page, shared by every app in the org), or null.
 */
async function recorderName(workspace: Workspace): Promise<string | null> {
  try {
    const a = await auth();
    if (!a) return null;
    let org = workspace.org;
    if (!org) {
      const { apps } = await onNode((client) => client.apps.list({}));
      org = (apps as { appId: string; org?: string }[]).find((x) => x.appId === workspace.appId)?.org;
    }
    if (!org) return null;
    const o = (await onNode((client) => client.orgs.get({ org: org! }))) as { memberMetadata?: Record<string, { name?: unknown } | null> };
    const name = o.memberMetadata?.[a.accountId]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch (e) {
    await log(`speakers: no name for the recorder: ${describe(e)}`);
    return null;
  }
}

/** Starts the reader in the recorded tab. Without it (another site, a refused injection) lines stay You / Others. */
async function startSpeakerReader(tabId: number, me: string | null): Promise<void> {
  await saveSpeakers({ ...NO_SPEAKERS, tab: tabId, me });
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["speakers.js"] });
    await log("speakers: reader started");
  } catch (e) {
    await log(`speakers: reader not started: ${describe(e)}`);
  }
}

async function stopSpeakerReader(): Promise<void> {
  const st = await speakers();
  if (st.tab === null) return;
  try {
    await chrome.tabs.sendMessage(st.tab, { target: "speakers", type: "stop" });
  } catch {
    // The tab closed or the reader never started: nothing to stop.
  }
}

async function onSpeakers(e: SpeakersEvent, tabId: number | undefined): Promise<void> {
  const st = await speakers();
  if (st.tab === null || tabId !== st.tab) return;
  const names = [...e.speaking].sort();
  const self = e.self ?? st.self;
  const participants = e.participants.length ? e.participants : st.participants;
  const timeline = pushChange(st.timeline, { at: e.at, names }, TIMELINE_LIMIT);
  if (timeline === st.timeline && self === st.self && participants.join("|") === st.participants.join("|")) return;
  await saveSpeakers({ ...st, timeline, self, participants });
  const via = e.via;
  await setStatus((s) =>
    s.phase === "recording" || s.phase === "loading-model"
      ? {
          ...s,
          speakers: { via: via ?? s.speakers?.via ?? null, participants: participants.length, self },
        }
      : s,
  );
}

/** The name for a line: the recorder's own name for the microphone, whoever the page showed talking for the call. */
async function lineName(speaker: "you" | "others", startedAt: number | undefined, startMs: number, endMs: number): Promise<string> {
  if (!(await settings()).speakerNames) return "";
  const st = await speakers();
  if (speaker === "you") return st.self ?? st.me ?? "";
  if (startedAt === undefined) return "";
  return nameFor(st.timeline, startedAt + startMs, startedAt + endMs, { exclude: [st.self, st.me ?? null], participants: st.participants });
}

// ── sign-in ──────────────────────────────────────────────────────────────────

/** The sign-in under way, if any (one window at a time). */
let signingIn: Promise<AuthState> | null = null;

/**
 * Sign in, or, while a sign-in window is already open, bring that window to the
 * front and wait for it: pressing Sign in or Create an account twice never opens
 * a second window. (Each sign-in seals its session to its own key, so a second
 * one could not use the first window's answer anyway.)
 */
async function signIn(intent?: SignInIntent, workspace?: NewWorkspace): Promise<AuthState> {
  if (signingIn) {
    if (await focusAuthWindow()) return signingIn;
    signingIn = null;
  }
  const run = openSignIn(intent, workspace);
  signingIn = run;
  try {
    return await run;
  } finally {
    if (signingIn === run) signingIn = null;
  }
}

async function openSignIn(intent?: SignInIntent, workspace?: NewWorkspace): Promise<AuthState> {
  const s = await settings();
  const page = await servedPage(s.pageOverride);
  const request = await newHandoff();
  // Starting a workspace: the ones there now, so the new one can be told apart after.
  const before = intent === "create" ? new Set((await listWorkspaces().catch(() => [])).map((w) => w.appId)) : null;
  const url = signInUrl(page.origin, page.version, request, intent, workspace);
  const answer = await openAuthWindow(url, `https://${chrome.runtime.id}.chromiumapp.org/`);
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
  await write("session", KEYS.signedOutReason, null);
  let done = next;
  if (before) {
    // The window created a workspace: choose it, so the popup opens on it.
    const made = (await listWorkspaces().catch(() => [])).find((w) => !before.has(w.appId));
    if (made) {
      done = { ...next, workspace: made };
      await saveAuth(done);
    }
  }
  reopenPopup();
  return done;
}

/**
 * The popup closed when the sign-in window took focus; open it again so the
 * person carries on where they were. Chrome allows this from Chrome 127; where
 * it does not, the toolbar icon is one click away.
 */
function reopenPopup(): void {
  void chrome.action?.openPopup?.()?.catch(() => undefined);
}

/**
 * Is the signed-in account still there? Opening the popup asks: the node
 * refuses a session whose account is gone (a wiped cluster, a removed
 * account, a revoked session), and `onNode` signs out on that. A workspace
 * the account no longer reaches is unchosen, so the popup offers the list.
 * A node that does not answer changes nothing: offline is not signed out.
 */
async function checkSession(): Promise<{ signedIn: boolean }> {
  const a = await auth();
  if (!a) return { signedIn: false };
  const current = await status();
  if (current.phase !== "idle" && current.phase !== "saved" && current.phase !== "error") return { signedIn: true };
  try {
    const list = await listWorkspaces();
    const chosen = a.workspace;
    if (chosen && !list.some((w) => w.appId === chosen.appId)) {
      const now = await auth();
      if (now) await saveAuth({ ...now, workspace: null });
      await log(`checkSession: workspace ${chosen.appId} is gone`);
    }
    return { signedIn: true };
  } catch (e) {
    if (isSignedOut(e)) {
      await log("checkSession: signed out by the node");
      return { signedIn: false };
    }
    return { signedIn: true };
  }
}

async function listWorkspaces(): Promise<Workspace[]> {
  // Every workspace only on a page on this machine; Cloud lists Sylence's.
  const dev = isLocalPage((await settings()).pageOverride);
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
    lastCaps = caps;
    const tier = resolveTier(s.tier, caps, s.language);
    // Never record into a model that is not on the laptop: downloading it mid-call
    // is what overwhelms a small machine, and the call would go untranscribed.
    if (!(caps.cached ?? []).includes(tier)) {
      throw new Error(`Download the speech model first (${TIERS[tier].name}): open the model chip below.`);
    }
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
    await chrome.storage.session.set({ "sylence:tab": tabId });
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
    const me = s.speakerNames ? await recorderName(workspace) : null;
    if (s.speakerNames && platform !== "other") await startSpeakerReader(tabId, me);
    else await saveSpeakers({ ...NO_SPEAKERS, me });
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
/** What the laptop can do, as the offscreen page measured it at the last start. */
let lastCaps: Capabilities | null = null;
/** The notes the offscreen page is writing (`notes` / `notesError` settle it). */
let notesWait: { resolve: (n: Notes) => void; reject: (e: Error) => void } | null = null;
/** The transcript the offscreen page is redoing (`improved` / `improveError` settle it). */
let improveWait: { resolve: (e: Extract<OffscreenEvent, { type: "improved" }>) => void; reject: (e: Error) => void } | null = null;
/** Longest the second pass may take: the call's length, and at least this. */
export const IMPROVE_MIN_TIMEOUT_MS = 20 * 60_000;
/** Longest a meeting's notes may take before phrase matching stands in. */
export const NOTES_TIMEOUT_MS = 10 * 60_000;

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
  await stopSpeakerReader();
  await closeOffscreen().catch(() => undefined);
  await setStatus((st) => ({ ...st, phase: "error", error: message, meeting: null, link: null }));
}

/**
 * The action items said in the meeting (`lib/actionItems.ts`), added to it:
 * read back the saved transcript, skip what is already there, add the rest.
 */
async function savedTranscript(meeting: { id: string; appId: string }): Promise<TranscriptLine[]> {
  const lines: TranscriptLine[] = [];
  let from: number | null = 0;
  while (from !== null) {
    const fromSeq: number = from;
    const page = await onNode((_c, app) => app.transcript({ meetingId: meeting.id, fromSeq, limit: 500 }), meeting.appId);
    lines.push(...page.segments);
    from = page.next;
  }
  return lines;
}

async function addFoundActions(meeting: { id: string; appId: string }, read?: TranscriptLine[]): Promise<number> {
  const lines = read ?? (await savedTranscript(meeting));
  const existing = await onNode((_c, app) => app.listActions({ meetingId: meeting.id }), meeting.appId);
  const found = findActions(
    lines,
    existing.map((x) => x.text),
  );
  for (const f of found) {
    await onNode(
      (_c, app) =>
        app.addAction({ meetingId: meeting.id, text: f.text.slice(0, 500), assignee: f.assignee.slice(0, 100), sourceSeq: f.sourceSeq }),
      meeting.appId,
    );
  }
  return found.length;
}

/**
 * The notes model (lib/notes.ts, run by the offscreen page) reads the saved
 * transcript and writes the summary and action items, which are added to the
 * meeting: the summary only when the meeting has none, each task once. If the
 * model finds no task, phrase matching still looks. Throws when the model
 * could not run, and the caller falls back to phrase matching.
 */
async function writeMeetingNotes(
  meeting: { id: string; appId: string },
  model: NotesModelId,
  phrases = true,
): Promise<{ actions: number; wroteSummary: boolean; byModel: boolean }> {
  const lines = await savedTranscript(meeting);
  if (lines.length === 0) return { actions: 0, wroteSummary: false, byModel: true };
  await setStatus((st) => ({ ...st, phase: "notes", notes: { model, fraction: 0, step: "download" } }));
  const result = new Promise<Notes>((resolve, reject) => {
    notesWait = { resolve, reject };
  });
  const timer = setTimeout(() => notesWait?.reject(new Error("the notes took too long")), NOTES_TIMEOUT_MS);
  let notes: Notes;
  try {
    await toOffscreen({ target: "offscreen", type: "notes", model, lines: lines.map((l) => ({ seq: l.seq, speaker: l.speaker, name: l.name, text: l.text })) });
    notes = await result;
  } finally {
    clearTimeout(timer);
    notesWait = null;
  }
  await log(`notes: ${notes.actions.length} tasks, summary ${notes.summary.length} chars`);
  const existing = await onNode((_c, app) => app.listActions({ meetingId: meeting.id }), meeting.appId);
  const add = actionsToAdd(notes.actions, existing.map((x) => x.text));
  for (const a of add) {
    await onNode((_c, app) => app.addAction({ meetingId: meeting.id, text: a.text, assignee: a.assignee, sourceSeq: null }), meeting.appId);
  }
  const actions = add.length > 0 || !phrases ? add.length : await addFoundActions(meeting, lines);
  let wroteSummary = false;
  // A title is not a summary: the small model sometimes writes only one.
  if (notes.summary.split(/\s+/).length >= 8) {
    const current = await onNode((_c, app) => app.getMeeting({ meetingId: meeting.id }), meeting.appId);
    if (!current.summary.trim()) {
      await onNode((_c, app) => app.setSummary({ meetingId: meeting.id, summary: notes.summary }), meeting.appId);
      wroteSummary = true;
    }
  }
  return { actions, wroteSummary, byModel: add.length > 0 || wroteSummary };
}

/** How many times a batch of the redone transcript is sent before giving up. */
const IMPROVE_TRIES = 3;

async function withTries<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < IMPROVE_TRIES; i++) {
    try {
      return await work();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Drops segments `fromSeq`..`beforeSeq`, batch by batch. */
async function dropSegments(meeting: { id: string; appId: string }, fromSeq: number, beforeSeq: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await withTries(() => onNode((_c, app) => app.dropSegments({ meetingId: meeting.id, fromSeq, beforeSeq }), meeting.appId));
    if (r.remaining === 0) return;
  }
}

/**
 * The second pass (lib/improve.ts): the offscreen page transcribes the whole
 * recording again with the best model; its lines, named from the speaker
 * timeline, are appended after the live ones, then the live ones are dropped.
 * If the upload fails halfway, what was sent is dropped and the live
 * transcript stays. Returns why it did not replace the transcript, or null.
 */
async function improveTranscript(meeting: { id: string; appId: string }, language: string, durationMs: number): Promise<string | null> {
  await setStatus((st) => ({ ...st, phase: "improving", improve: { step: "transcribe", fraction: 0 } }));
  const result = new Promise<Extract<OffscreenEvent, { type: "improved" }>>((resolve, reject) => {
    improveWait = { resolve, reject };
  });
  const timer = setTimeout(
    () => improveWait?.reject(new Error("the second pass took too long")),
    Math.max(IMPROVE_MIN_TIMEOUT_MS, durationMs),
  );
  let done: Extract<OffscreenEvent, { type: "improved" }>;
  try {
    await toOffscreen({ target: "offscreen", type: "improve", language });
    done = await result;
  } finally {
    clearTimeout(timer);
    improveWait = null;
  }
  await log(`improve: ${done.lines.length} lines`);
  if (done.lines.length === 0) return "The second pass heard no speech.";
  const current = await onNode((_c, app) => app.getMeeting({ meetingId: meeting.id }), meeting.appId);
  const base = current.nextSeq;
  const segments = [];
  for (const [i, l] of done.lines.entries()) {
    const name = await lineName(l.speaker, done.startedAt, l.startMs, l.endMs);
    segments.push({ seq: base + i, speaker: l.speaker, name, startMs: l.startMs, endMs: l.endMs, text: l.text.slice(0, 4_000) });
  }
  try {
    for (let i = 0; i < segments.length; i += 100) {
      const batch = segments.slice(i, i + 100);
      await withTries(() => onNode((_c, app) => app.appendSegments({ meetingId: meeting.id, segments: batch }), meeting.appId));
    }
  } catch (e) {
    await log(`improve: upload failed (${describe(e)}); keeping the live transcript`);
    await dropSegments(meeting, base, 0xffffffff).catch(() => undefined);
    return "The improved transcript couldn't be saved.";
  }
  await dropSegments(meeting, 0, base);
  return null;
}

/** Everything transcribed: send the rest, end the meeting, close the offscreen page. */
function finish(durationMs: number): Promise<void> {
  stopping ??= (async () => {
    await stopSpeakerReader();
    const s = await status();
    const q = await currentQueue();
    const all = q ? await q.drain() : true;
    let link: string | null = null;
    let error: string | null = null;
    let actions = 0;
    let wroteSummary = false;
    let notesBy: RecorderStatus["notesBy"] = null;
    let improved: RecorderStatus["improved"] = null;
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
      const s = await settings();
      if (all && !error && s.improveAfterCall) {
        // Never downloads the big model here: it runs only where it is allowed and already on the laptop.
        if (!lastCaps || !canImproveAfterCall(lastCaps)) {
          improved = {
            done: false,
            why: !lastCaps?.webgpu
              ? "This browser doesn't offer WebGPU, which the second pass needs."
              : lastCaps && tierBlock("best", lastCaps)
                ? `The second pass is off on this laptop: ${tierBlock("best", lastCaps)}`
                : "The second pass needs Whisper large-v3 turbo downloaded first (Settings, Speech model).",
          };
        } else {
          try {
            const why = await improveTranscript(meeting, s.language, durationMs);
            improved = why ? { done: false, why } : { done: true };
          } catch (e) {
            await log(`improve: ${describe(e)}`);
            improved = { done: false, why: `The second pass failed: ${describe(e)}` };
          }
          await setStatus((st) => ({ ...st, improve: null }));
        }
      }
      // Two switches, each on its own: Find action items (phrase matching) and
      // the experimental Smart notes (a model writes the summary and action items).
      if (all && !error && (s.autoActions || s.smartNotes)) {
        const model = s.smartNotes && lastCaps ? notesModelFor(s.notesModel, lastCaps) : null;
        let written = false;
        const why = !s.smartNotes
          ? ""
          : lastCaps && !lastCaps.webgpu
            ? "This browser doesn't offer WebGPU, which Smart notes need."
            : "Smart notes didn't run.";
        notesBy = s.autoActions ? { kind: "phrases", why } : null;
        if (model) {
          try {
            const r = await writeMeetingNotes(meeting, model, s.autoActions);
            actions = r.actions;
            wroteSummary = r.wroteSummary;
            written = true;
            notesBy = r.byModel
              ? { kind: "model", model }
              : s.autoActions
                ? { kind: "phrases", why: "The notes model found no task." }
                : null;
          } catch (e) {
            await log(`notes: ${describe(e)}${s.autoActions ? "; phrase matching instead" : ""}`);
            notesBy = s.autoActions ? { kind: "phrases", why: `The notes model failed: ${describe(e)}` } : null;
          }
        }
        if (!written && s.autoActions) {
          actions = await addFoundActions(meeting).catch(async (e: unknown) => {
            await log(`actions: ${describe(e)}`);
            return 0;
          });
        }
      }
    }
    await log(`finish: duration=${durationMs}ms uploaded=${all} pending=${q?.pending ?? 0} actions=${actions} error=${error ?? "none"}`);
    if (all && q) await q.clear();
    queue = all ? null : q;
    recordingTab = null;
    await closeOffscreen().catch(() => undefined);
    await setStatus((st) => ({
      ...st,
      phase: "saved",
      link,
      actions,
      wroteSummary,
      notesBy,
      improved,
      improve: null,
      notes: null,
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
      const name = await lineName(event.speaker, event.startedAt, event.startMs, event.endMs);
      await q.add({ speaker: event.speaker, name, startMs: event.startMs, endMs: event.endMs, text: event.text });
      const line: Line = { speaker: event.speaker, name, text: event.text.trim(), startMs: event.startMs };
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
    case "notesProgress":
      await setStatus((s) => ({ ...s, notes: { model: event.model, fraction: event.fraction, step: event.step } }));
      return;
    case "notes":
      notesWait?.resolve(event.notes);
      return;
    case "notesError":
      await log(`notes: ${event.error}`);
      notesWait?.reject(new Error(event.error));
      await setStatus((s) => (s.phase === "notes" ? s : { ...s, notes: null }));
      return;
    case "drained":
      await finish(event.durationMs);
      return;
    case "improveProgress":
      await setStatus((s) => (s.phase === "improving" ? { ...s, improve: { step: event.step, fraction: event.fraction } } : s));
      return;
    case "improved":
      improveWait?.resolve(event);
      return;
    case "improveError":
      await log(`improve: ${event.error}`);
      improveWait?.reject(new Error(event.error));
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
      return signIn(req.intent, req.workspace);
    case "signOut":
      await saveAuth(null);
      return null;
    case "listWorkspaces":
      return listWorkspaces();
    case "checkSession":
      return checkSession();
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
    case "preload": {
      await ensureOffscreen();
      // A model this device must not run is never downloaded, whoever asks.
      const caps = await toOffscreen<Capabilities>({ target: "offscreen", type: "caps" });
      lastCaps = caps;
      const blocked = tierBlock(req.tier, caps);
      if (blocked) throw new Error(`${TIERS[req.tier].name} isn't available on this device. ${blocked}`);
      return toOffscreen({ target: "offscreen", type: "preload", tier: req.tier });
    }
    case "preloadNotes":
      await ensureOffscreen();
      return toOffscreen({ target: "offscreen", type: "preloadNotes", model: req.model });
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const m = message as Partial<OffscreenEvent> & Partial<OffscreenCommand> & { type?: string };
  if (m.target === "offscreen" || (m.target as string | undefined) === "speakers") return false;
  if ((m.source as string | undefined) === "speakers") {
    const e = message as SpeakersEvent;
    offscreenEvents = offscreenEvents.then(() => onSpeakers(e, sender.tab?.id)).catch((err: unknown) => log(`speakers failed: ${describe(err)}`));
    return false;
  }
  if (m.source === "offscreen") {
    const e = message as OffscreenEvent;
    // Levels are for the popup. Everything else is handled in the order it was
    // sent: a burst of segments keeps every line, and `drained` comes after the
    // segments before it are queued.
    // The notes come while `drained` is still being handled (it waits for
    // them), so they cannot wait in line behind it.
    if (
      e.type === "notes" ||
      e.type === "notesError" ||
      e.type === "notesProgress" ||
      e.type === "improved" ||
      e.type === "improveError" ||
      e.type === "improveProgress"
    ) {
      void onOffscreen(e).catch((err: unknown) => log(`event ${e.type} failed: ${describe(err)}`));
    } else if (e.type !== "levels") {
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
    const tab = recordingTab ?? ((await chrome.storage.session.get("sylence:tab"))["sylence:tab"] as number | undefined);
    if (tab === tabId) await stop();
  })();
});

// A restarted worker sends what was waiting.
chrome.runtime.onStartup.addListener(() => void flushQueue(true));
