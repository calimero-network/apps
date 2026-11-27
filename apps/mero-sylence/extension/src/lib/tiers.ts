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
  /** Notes models already downloaded (lib/notes.ts). */
  cachedNotes?: ("small" | "better")[];
  /** `navigator.deviceMemory`, GB (Chrome caps it at 8); 0 when unknown. */
  deviceMemoryGb: number;
  cores: number;
  /** Tiers whose model files are already in the browser's cache. */
  cached?: TierId[];
  /** A Chromebook: integrated graphics that report WebGPU but cannot hold the big model. */
  chromeOS?: boolean;
  /** A phone or tablet. */
  mobile?: boolean;
}

/** The least a laptop needs for each model, so none is ever downloaded onto one it would lock up. */
export const MIN_MEMORY_GB = 4;
export const MIN_CORES = 4;

/**
 * Why `tier` must not run on this device, or `null` when it may. Unknown
 * memory or cores count as small for the big model (it needs every signal to
 * say yes) and as enough for the small ones (any desktop runs them).
 *
 * - Whisper large-v3 turbo (1.5 GB, GPU): a WebGPU adapter that takes 1 GB
 *   buffers, 8 GB of memory, 8 cores, and not a Chromebook.
 * - Whisper base: 4 GB of memory and 4 cores.
 * - Moonshine base and tiny: any laptop.
 * - Nothing on a phone or tablet.
 */
export function tierBlock(tier: TierId, caps: Capabilities): string | null {
  if (caps.mobile) return "Phones and tablets can't run the speech models.";
  if (tier === "best") {
    if (!caps.webgpu) return "Needs a graphics chip (WebGPU), which this browser doesn't offer.";
    if (caps.chromeOS) return "Too heavy for a Chromebook: it can lock the laptop up.";
    if (caps.deviceMemoryGb < 8) return "Needs 8 GB of memory or more.";
    if (caps.cores < 8) return "Needs 8 or more processor cores.";
    if (caps.maxBufferSize !== 0 && caps.maxBufferSize < 1 << 30) return "This graphics chip can't hold the model.";
    return null;
  }
  if (tier === "balanced") {
    if (caps.deviceMemoryGb > 0 && caps.deviceMemoryGb < MIN_MEMORY_GB) return `Needs ${MIN_MEMORY_GB} GB of memory or more.`;
    if (caps.cores > 0 && caps.cores < MIN_CORES) return `Needs ${MIN_CORES} or more processor cores.`;
  }
  return null;
}

/** Whether the second pass after a call may run: the big model is allowed here and already downloaded. */
export function canImproveAfterCall(caps: Capabilities | null): boolean {
  return !!caps && tierBlock("best", caps) === null && !!caps.cached?.includes("best");
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
  if (caps.webgpu && bigBuffers && memory >= 8 && tierBlock("best", caps) === null && caps.cached?.includes("best")) return "best";
  if (!isEnglish(language)) return "balanced";
  if (memory <= 4 || (caps.cores > 0 && caps.cores <= 2)) return "ultralight";
  return "light";
}

/** Whether `tier` can transcribe `language` on this laptop. */
export function tierFits(tier: TierId, caps: Capabilities, language: string): boolean {
  const t = TIERS[tier];
  if (!t.multilingual && !isEnglish(language)) return false;
  if (t.device === "webgpu" && !caps.webgpu) return false;
  return tierBlock(tier, caps) === null;
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
