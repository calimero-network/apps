/** What the extension's parts say to each other, and what they keep. */
import type { Platform } from "./platform";
import type { Speaker } from "./queue";
import type { Capabilities, TierId } from "./tiers";
import type { Notes, NotesModelId, NotesSetting } from "./notes";

export interface Settings {
  tier: TierId | "auto";
  /** BCP 47 code, or "" to detect. */
  language: string;
  mic: boolean;
  /** A development page to sign in on instead of Cloud's (e.g. http://localhost:5173). */
  pageOverride: string;
  /** Add the action items found in the transcript when a meeting ends. */
  autoActions: boolean;
  /**
   * Experimental: a small model on this laptop (WebGPU) writes a summary and the
   * action items. Off by default; off, or with no GPU, action items come from
   * phrase matching and there is no summary.
   */
  smartNotes: boolean;
  /** Which model Smart notes use (when on). */
  notesModel: NotesSetting;
  /** Name each line after who was talking, read from the call page. */
  speakerNames: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  tier: "auto",
  language: "en",
  mic: true,
  pageOverride: "",
  autoActions: true,
  smartNotes: false,
  notesModel: "auto",
  speakerNames: true,
};

export interface Workspace {
  appId: string;
  name: string;
}

export interface AuthState {
  accountId: string;
  session: { accountId: string; sessionToken: string; expiresAt: number; refreshToken: string };
  nodeUrl: string;
  nodes: string[];
  /** The page signed in on: where links go. */
  page: { origin: string; version: string | null };
  workspace: Workspace | null;
}

export interface Line {
  speaker: Speaker;
  /** Who said it, from the call page; "" when unknown. */
  name?: string;
  text: string;
  startMs: number;
}

export type Phase = "idle" | "starting" | "loading-model" | "recording" | "stopping" | "notes" | "saved" | "error";

export interface ModelProgress {
  /** 0–1 over every file. */
  fraction: number;
  file: string;
}

export interface RecorderStatus {
  phase: Phase;
  tier: TierId | null;
  meeting: { id: string; appId: string; title: string; platform: Platform; startedAt: number } | null;
  model: ModelProgress | null;
  /** The last few lines, for the popup. */
  lines: Line[];
  pending: number;
  uploadError: string | null;
  /** Something the person should know (the model was stepped down…). */
  notice: string | null;
  error: string | null;
  /** The saved meeting's page. */
  link: string | null;
  /** Action items added from the transcript when it ended. */
  actions?: number;
  /** While the notes are written: the model's download, then the parts done. */
  notes?: { model: NotesModelId; fraction: number; step: "download" | "write" } | null;
  /** The notes model wrote the summary (and the action items). */
  wroteSummary?: boolean;
  /** Where speaker names come from while recording: the reader that found one, and how many people the page shows. */
  speakers?: { via: string | null; participants: number; self: string | null } | null;
  /** Who found the action items: the notes model, or phrase matching (with why). */
  notesBy?: { kind: "model"; model: NotesModelId } | { kind: "phrases"; why: string } | null;
}

export const IDLE: RecorderStatus = {
  phase: "idle",
  tier: null,
  meeting: null,
  model: null,
  lines: [],
  pending: 0,
  uploadError: null,
  notice: null,
  error: null,
  link: null,
};

/** Storage keys. `local` survives restarts; `session` lasts while the browser runs. */
export const KEYS = {
  settings: "sylence:settings",
  auth: "sylence:auth",
  queue: "sylence:queue",
  status: "sylence:status",
  transcript: "sylence:transcript",
  micGranted: "sylence:mic-granted",
  /** Why the extension signed itself out, for the signed-out screen. */
  signedOutReason: "sylence:signed-out-reason",
  /** Who talked when, during the recording (lib/speakers.ts). */
  speakers: "sylence:speakers",
} as const;

/** Popup / side panel → service worker. */
export type Request =
  | { type: "signIn"; intent?: "create" }
  | { type: "signOut" }
  | { type: "listWorkspaces" }
  | { type: "checkSession" }
  | { type: "chooseWorkspace"; workspace: Workspace }
  | { type: "start"; tabId: number }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "preload"; tier: TierId }
  | { type: "preloadNotes"; model: NotesModelId };

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** Service worker → offscreen page. */
export type OffscreenCommand =
  | { target: "offscreen"; type: "capture"; streamId: string; mic: boolean; tier: TierId; language: string }
  | { target: "offscreen"; type: "stop" }
  | { target: "offscreen"; type: "preload"; tier: TierId }
  | { target: "offscreen"; type: "caps" }
  | { target: "offscreen"; type: "preloadNotes"; model: NotesModelId }
  | { target: "offscreen"; type: "notes"; model: NotesModelId; lines: { seq: number; speaker: string; name?: string; text: string }[] };

/** Offscreen page → service worker (and the popup, for levels). */
export type OffscreenEvent =
  | { source: "offscreen"; type: "segment"; speaker: Speaker; startMs: number; endMs: number; text: string; startedAt?: number }
  | { source: "offscreen"; type: "model"; tier: TierId; state: "loading" | "ready" | "error"; progress?: ModelProgress; error?: string }
  | { source: "offscreen"; type: "levels"; you: number; others: number }
  | { source: "offscreen"; type: "stepDown"; from: TierId; to: TierId }
  | { source: "offscreen"; type: "drained"; durationMs: number }
  | { source: "offscreen"; type: "captureError"; message: string }
  | { source: "offscreen"; type: "notice"; message: string }
  | { source: "offscreen"; type: "log"; message: string }
  | { source: "offscreen"; type: "tick" }
  | { source: "offscreen"; type: "notesProgress"; model: NotesModelId; fraction: number; step: "download" | "write" }
  | { source: "offscreen"; type: "notes"; notes: Notes }
  | { source: "offscreen"; type: "notesError"; error: string };

export type { Capabilities };

/** The call page's speaker reader (src/content/speakers.ts) → service worker. */
export interface SpeakersEvent {
  source: "speakers";
  type: "speakers";
  at: number;
  platform: Platform;
  speaking: string[];
  participants: string[];
  self: string | null;
  via: string | null;
}
