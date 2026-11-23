/**
 * The speech models, all run on this laptop with transformers.js. Audio never
 * leaves the machine; only the text is sent to the workspace.
 */
export type TierId = "best" | "balanced" | "light" | "ultralight";
export type Device = "webgpu" | "wasm";

export interface Tier {
  id: TierId;
  /** Shown in the model chip and stored with the meeting. */
  name: string;
  /** Stored as the meeting's `model`. */
  modelId: string;
  repo: string;
  device: Device;
  dtype: Record<string, string> | string;
  /** Download size, MB (encoder + decoder). */
  sizeMb: number;
  multilingual: boolean;
  blurb: string;
}

export const TIERS: Record<TierId, Tier> = {
  best: {
    id: "best",
    name: "Whisper large-v3 turbo",
    modelId: "whisper-large-v3-turbo",
    repo: "onnx-community/whisper-large-v3-turbo",
    device: "webgpu",
    dtype: { encoder_model: "fp16", decoder_model_merged: "q4f16" },
    sizeMb: 1467,
    multilingual: true,
    blurb: "The most accurate. Needs a graphics chip (WebGPU) and a one-time 1.5 GB download.",
  },
  balanced: {
    id: "balanced",
    name: "Whisper base",
    modelId: "whisper-base",
    repo: "onnx-community/whisper-base",
    device: "wasm",
    dtype: "q8",
    sizeMb: 77,
    multilingual: true,
    blurb: "Good accuracy in 99 languages. Runs on any laptop's processor.",
  },
  light: {
    id: "light",
    name: "Moonshine base",
    modelId: "moonshine-base",
    repo: "onnx-community/moonshine-base-ONNX",
    device: "wasm",
    dtype: "q8",
    sizeMb: 63,
    multilingual: false,
    blurb: "Fast and light, English only. Keeps up on older laptops.",
  },
  ultralight: {
    id: "ultralight",
    name: "Moonshine tiny",
    modelId: "moonshine-tiny",
    repo: "onnx-community/moonshine-tiny-ONNX",
    device: "wasm",
    dtype: "q8",
    sizeMb: 28,
    multilingual: false,
    blurb: "The smallest, English only. For low-memory machines.",
  },
};

/** Best first: the order "step down" walks. */
export const TIER_ORDER: TierId[] = ["best", "balanced", "light", "ultralight"];

/** What the laptop can do, as the offscreen page measures it. */
export interface Capabilities {
  /** A WebGPU adapter was granted (Brave's shields can hide `navigator.gpu`). */
  webgpu: boolean;
  /** The adapter's `maxBufferSize`, bytes; 0 when unknown. */
  maxBufferSize: number;
  /** `navigator.deviceMemory`, GB (Chrome caps it at 8); 0 when unknown. */
  deviceMemoryGb: number;
  cores: number;
  /** Tiers whose model files are already in the browser's cache. */
  cached?: TierId[];
}

/** English (or auto-detect on an English browser) may use the English-only models. */
export function isEnglish(language: string): boolean {
  return language === "en" || language.startsWith("en-");
}

/**
 * The model to use when the setting is "Auto".
 *
 * - a WebGPU adapter that can hold the turbo encoder, and 8 GB of memory: Whisper large-v3 turbo;
 * - otherwise, English: Moonshine base, or Moonshine tiny on ≤ 4 GB / ≤ 2 cores;
 * - otherwise (another language, or unknown): Whisper base, the only multilingual model that runs on a CPU.
 */
export function pickTier(caps: Capabilities, language: string): TierId {
  const memory = caps.deviceMemoryGb || 4;
  const bigBuffers = caps.maxBufferSize === 0 || caps.maxBufferSize >= 1 << 30;
  // The big model is a 1.5 GB download: Auto uses it once it is on the laptop
  // (Settings, Download), so a first call never waits on it and records nothing.
  if (caps.webgpu && bigBuffers && memory >= 8 && caps.cached?.includes("best")) return "best";
  if (!isEnglish(language)) return "balanced";
  if (memory <= 4 || (caps.cores > 0 && caps.cores <= 2)) return "ultralight";
  return "light";
}

/** Whether `tier` can transcribe `language` on this laptop. */
export function tierFits(tier: TierId, caps: Capabilities, language: string): boolean {
  const t = TIERS[tier];
  if (!t.multilingual && !isEnglish(language)) return false;
  if (t.device === "webgpu" && !caps.webgpu) return false;
  return true;
}

/** The next lighter model that can still transcribe `language`, or `null` at the bottom. */
export function stepDown(tier: TierId, language: string): TierId | null {
  for (const next of TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1)) {
    if (TIERS[next].multilingual || isEnglish(language)) return next;
  }
  return null;
}

/** The tier to run: the person's choice if it fits, else the automatic one. */
export function resolveTier(choice: TierId | "auto", caps: Capabilities, language: string): TierId {
  if (choice !== "auto" && tierFits(choice, caps, language)) return choice;
  return pickTier(caps, language);
}

/**
 * Whether transcription is falling behind: more than `maxBacklogSec` of speech
 * waits, or each second of speech takes longer than `maxRealtime` seconds.
 */
export function fallingBehind(backlogSec: number, realtimeFactor: number, maxBacklogSec = 45, maxRealtime = 1.2): boolean {
  return backlogSec > maxBacklogSec || realtimeFactor > maxRealtime;
}

/** Languages offered; "" lets Whisper detect it. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "", name: "Detect automatically" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "hr", name: "Croatian" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
];

/** Whisper's language name for a code, as transformers.js takes it. */
export function whisperLanguage(code: string): string | undefined {
  const map: Record<string, string> = {
    en: "english",
    de: "german",
    es: "spanish",
    fr: "french",
    hr: "croatian",
    it: "italian",
    nl: "dutch",
    pl: "polish",
    pt: "portuguese",
    ja: "japanese",
    zh: "chinese",
  };
  return map[code];
}
