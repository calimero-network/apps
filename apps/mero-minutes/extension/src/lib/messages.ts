/** What the extension's parts say to each other, and what they keep. */
import type { Platform } from "./platform";
import type { Speaker } from "./queue";
import type { Capabilities, TierId } from "./tiers";

export interface Settings {
  tier: TierId | "auto";
  /** BCP 47 code, or "" to detect. */
  language: string;
  mic: boolean;
  /** A development page to sign in on instead of Cloud's (e.g. http://localhost:5173). */
  pageOverride: string;
}

export const DEFAULT_SETTINGS: Settings = { tier: "auto", language: "en", mic: true, pageOverride: "" };

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
  text: string;
  startMs: number;
}

export type Phase = "idle" | "starting" | "loading-model" | "recording" | "stopping" | "saved" | "error";

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
  settings: "minutes:settings",
  auth: "minutes:auth",
  queue: "minutes:queue",
  status: "minutes:status",
  transcript: "minutes:transcript",
  micGranted: "minutes:mic-granted",
} as const;

/** Popup / side panel → service worker. */
export type Request =
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "listWorkspaces" }
  | { type: "chooseWorkspace"; workspace: Workspace }
  | { type: "start"; tabId: number }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "preload"; tier: TierId };

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** Service worker → offscreen page. */
export type OffscreenCommand =
  | { target: "offscreen"; type: "capture"; streamId: string; mic: boolean; tier: TierId; language: string }
  | { target: "offscreen"; type: "stop" }
  | { target: "offscreen"; type: "preload"; tier: TierId }
  | { target: "offscreen"; type: "caps" };

/** Offscreen page → service worker (and the popup, for levels). */
export type OffscreenEvent =
  | { source: "offscreen"; type: "segment"; speaker: Speaker; startMs: number; endMs: number; text: string }
  | { source: "offscreen"; type: "model"; tier: TierId; state: "loading" | "ready" | "error"; progress?: ModelProgress; error?: string }
  | { source: "offscreen"; type: "levels"; you: number; others: number }
  | { source: "offscreen"; type: "stepDown"; from: TierId; to: TierId }
  | { source: "offscreen"; type: "drained"; durationMs: number }
  | { source: "offscreen"; type: "captureError"; message: string }
  | { source: "offscreen"; type: "notice"; message: string }
  | { source: "offscreen"; type: "log"; message: string }
  | { source: "offscreen"; type: "tick" };

export type { Capabilities };
