import type { TimedChunk, Turn } from "../lib/upload";

/** `load` and `voices` download models (the speech model, then the voice models); the others run them. */
export type SpeechStage = "load" | "transcribe" | "voices" | "diarize";

/** Page → speech worker. */
export type ToSpeech =
  | {
      type: "run";
      /** 16 kHz mono. */
      audio: Float32Array;
      /** BCP 47 code, "" to detect. */
      language: string;
      /** The model: Whisper large-v3 turbo on the GPU (`best`), or Whisper base on the processor. */
      tier: "best" | "balanced";
    }
  | {
      /** Only tell the voices apart (no transcript): the lines are there already. Answers `done` with no chunks. */
      type: "voices";
      /** 16 kHz mono. */
      audio: Float32Array;
    };

/** Speech worker → page. */
export type FromSpeech =
  | {
      type: "progress";
      stage: SpeechStage;
      fraction: number;
      /** While downloading: bytes so far and in all, over every file of the stage. */
      bytes?: { loaded: number; total: number };
    }
  | { type: "model"; modelId: string; name: string }
  | { type: "done"; chunks: TimedChunk[]; turns: Turn[] }
  | { type: "error"; error: string };
