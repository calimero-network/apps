import type { ChatMessage } from "../lib/insights";

/** The emotion model the insights worker runs: GoEmotions (28 labels), 8-bit. */
export const EMOTION_MODEL = { repo: "SamLowe/roberta-base-go_emotions-onnx", dtype: "q8", sizeMb: 125, name: "go-emotions" } as const;

/** The writing models: the extension's Smart notes models (Qwen2.5 Instruct, WebGPU; extension/src/lib/notes.ts). */
export type WriterId = "small" | "better";

export const WRITERS: Record<WriterId, { name: string; repo: string; dtype: string; sizeMb: number }> = {
  small: { name: "qwen2.5-0.5b", repo: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q4f16", sizeMb: 483 },
  better: { name: "qwen2.5-1.5b", repo: "onnx-community/Qwen2.5-1.5B-Instruct", dtype: "q4f16", sizeMb: 1221 },
};

/** "better" with 8 GB of memory or more (or unknown above 4), else "small". */
export function pickWriter(deviceMemoryGb: number | undefined): WriterId {
  return (deviceMemoryGb ?? 4) >= 8 ? "better" : "small";
}

/** Page → insights worker. */
export type ToInsightsWorker =
  | { type: "classify"; id: number; texts: string[] }
  | { type: "loadWriter"; model: WriterId }
  | { type: "generate"; id: number; messages: ChatMessage[] };

/** Insights worker → page. `fraction` is 0–1 of the current step. */
export type FromInsightsWorker =
  | { type: "progress"; step: "model" | "classify" | "writer"; fraction: number }
  | { type: "scores"; id: number; scores: Record<string, number>[] }
  | { type: "writerReady"; model: WriterId }
  | { type: "text"; id: number; text: string }
  | { type: "error"; id?: number; error: string };
