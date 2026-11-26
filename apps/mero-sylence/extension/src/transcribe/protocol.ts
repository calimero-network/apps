import type { TierId } from "../lib/tiers";

/** Page → speech worker. */
export type ToWorker =
  | { type: "load"; tier: TierId }
  | {
      type: "transcribe";
      id: number;
      audio: Float32Array;
      language: string;
      /** Whisper only: also answer with each sentence's start and end, seconds into `audio`. */
      timestamps?: boolean;
    };

/** One sentence of a longer stretch, seconds from its start. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

/** Speech worker → page. */
export type FromWorker =
  | { type: "progress"; tier: TierId; fraction: number; file: string }
  | { type: "ready"; tier: TierId; device: string }
  | { type: "loadError"; tier: TierId; error: string }
  | { type: "text"; id: number; text: string; ms: number; chunks?: TimedText[] }
  | { type: "transcribeError"; id: number; error: string };
