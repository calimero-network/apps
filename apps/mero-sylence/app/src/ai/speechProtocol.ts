import type { TimedChunk, Turn } from "../lib/upload";

export type SpeechStage = "load" | "transcribe" | "diarize";

/** Page → speech worker. */
export type ToSpeech = {
  type: "run";
  /** 16 kHz mono. */
  audio: Float32Array;
  /** BCP 47 code, "" to detect. */
  language: string;
  /** Use Whisper large-v3 turbo on the GPU. */
  webgpu: boolean;
};

/** Speech worker → page. */
export type FromSpeech =
  | { type: "progress"; stage: SpeechStage; fraction: number }
  | { type: "model"; modelId: string; name: string }
  | { type: "done"; chunks: TimedChunk[]; turns: Turn[] }
  | { type: "error"; error: string };
