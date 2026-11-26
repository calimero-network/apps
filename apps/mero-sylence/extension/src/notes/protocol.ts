import type { ChatMessage, NotesModelId } from "../lib/notes";

/** Offscreen page → notes worker. */
export type ToNotesWorker =
  | { type: "load"; model: NotesModelId; device?: "webgpu" | "wasm" }
  | { type: "generate"; id: number; messages: ChatMessage[] };

/** Notes worker → offscreen page. */
export type FromNotesWorker =
  | { type: "progress"; model: NotesModelId; fraction: number; file: string }
  | { type: "ready"; model: NotesModelId }
  | { type: "loadError"; model: NotesModelId; error: string }
  | { type: "text"; id: number; text: string }
  | { type: "generateError"; id: number; error: string };
