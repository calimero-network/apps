import { TIERS, type TierId } from "../../../extension/src/lib/tiers";

/**
 * What this device can run, read before an upload is transcribed, so a
 * laptop is never handed a model it cannot hold. A 1.5 GB Whisper turbo on a
 * Chromebook's integrated GPU locks the machine up; a phone cannot decode a
 * long recording at all.
 *
 * What a page can learn is coarse: `navigator.deviceMemory` (Chrome rounds it
 * down and caps it at 8 GB; other browsers leave it out), the number of
 * logical cores, whether a WebGPU adapter is granted and how large a buffer it
 * takes, and the platform. The processor's model is not exposed to pages.
 * Unknown counts as "small": the big model needs every signal to say yes.
 */
export interface DeviceInfo {
  webgpu: boolean;
  /** The adapter's `maxBufferSize`, bytes; 0 when unknown. */
  maxBufferSize: number;
  /** GB, as the browser reports it (at most 8); 0 when unknown. */
  memoryGb: number;
  /** Logical cores; 0 when unknown. */
  cores: number;
  chromeOS: boolean;
  mobile: boolean;
  /** The graphics adapter, as the browser names it ("apple · metal-3"), when it does. */
  gpu: string | null;
  /** Speech models already in this browser's cache. */
  cached: TierId[];
}

/** The two models an upload can use: Whisper turbo on the GPU, Whisper base on the processor. */
export type UploadTier = Extract<TierId, "best" | "balanced">;

export type UploadPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The model this run uses. */
      tier: UploadTier;
      /** The device may run the big model: offer it. */
      canBest: boolean;
      /** Expect a long wait (a small machine). */
      slow: boolean;
    };

interface GpuAdapterLike {
  limits?: { maxBufferSize?: number };
  info?: { vendor?: string; architecture?: string; description?: string };
}
type Nav = Navigator & {
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
};

export async function detectDevice(nav: Navigator = navigator, store: CacheStorage | undefined = globalThis.caches): Promise<DeviceInfo> {
  const n = nav as Nav;
  let webgpu = false;
  let maxBufferSize = 0;
  let gpu: string | null = null;
  try {
    const adapter = n.gpu ? await n.gpu.requestAdapter() : null;
    if (adapter) {
      webgpu = true;
      maxBufferSize = adapter.limits?.maxBufferSize ?? 0;
      const i = adapter.info;
      const name = [i?.vendor, i?.architecture].filter(Boolean).join(" · ") || i?.description || "";
      gpu = name || null;
    }
  } catch {
    webgpu = false;
  }
  const ua = n.userAgent ?? "";
  const platform = n.userAgentData?.platform ?? "";
  return {
    webgpu,
    maxBufferSize,
    memoryGb: typeof n.deviceMemory === "number" ? n.deviceMemory : 0,
    cores: typeof n.hardwareConcurrency === "number" ? n.hardwareConcurrency : 0,
    chromeOS: /CrOS/.test(ua) || /chrome ?os/i.test(platform),
    mobile: n.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/.test(ua),
    gpu,
    cached: await cachedTiers(store),
  };
}

/** The least a device needs for Whisper base on its processor. */
export const MIN_MEMORY_GB = 4;
export const MIN_CORES = 4;

/**
 * Whether this device may transcribe an upload, and with which model.
 *
 * - No: a phone or tablet, under 4 GB of memory, or under 4 cores.
 * - Whisper turbo (1.5 GB) only where every signal says it fits: a WebGPU
 *   adapter that takes 1 GB buffers, 8 GB of memory, 8 cores, and not a
 *   Chromebook. Even then it is used only once it is downloaded or the person
 *   asks for it (`wantBest`): never a surprise 1.5 GB download.
 * - Otherwise Whisper base (77 MB) on the processor.
 */
export function uploadPlan(d: DeviceInfo, wantBest = false): UploadPlan {
  if (d.mobile) return { ok: false, reason: "Transcribing needs a desktop or laptop. Phones and tablets cannot run the speech model." };
  if (d.memoryGb > 0 && d.memoryGb < MIN_MEMORY_GB) {
    return { ok: false, reason: `This device reports ${d.memoryGb} GB of memory; the speech model needs at least ${MIN_MEMORY_GB} GB.` };
  }
  if (d.cores > 0 && d.cores < MIN_CORES) {
    return { ok: false, reason: `This device has ${d.cores} processor cores; the speech model needs at least ${MIN_CORES}.` };
  }
  const canBest = d.webgpu && d.maxBufferSize >= 1 << 30 && d.memoryGb >= 8 && d.cores >= 8 && !d.chromeOS;
  const tier: UploadTier = canBest && (wantBest || d.cached.includes("best")) ? "best" : "balanced";
  const slow = tier === "balanced" && ((d.memoryGb > 0 && d.memoryGb <= 4) || (d.cores > 0 && d.cores <= 4) || d.chromeOS);
  return { ok: true, tier, canBest, slow };
}

/** "8 GB+ memory · 10 cores · graphics: apple · metal-3", the parts the browser gave. */
export function describeDevice(d: DeviceInfo): string {
  const parts: string[] = [];
  if (d.memoryGb) parts.push(`${d.memoryGb >= 8 ? "8 GB+" : `${d.memoryGb} GB`} memory`);
  if (d.cores) parts.push(`${d.cores} cores`);
  parts.push(d.webgpu ? `graphics${d.gpu ? `: ${d.gpu}` : " chip"}` : "no graphics acceleration");
  if (d.chromeOS) parts.push("ChromeOS");
  return parts.join(" · ");
}

/** "Whisper base · 77 MB, downloads once" or "· ready". */
export function describeModel(tier: UploadTier, d: DeviceInfo): string {
  const t = TIERS[tier];
  const size = t.sizeMb >= 1000 ? `${(t.sizeMb / 1000).toFixed(1)} GB` : `${t.sizeMb} MB`;
  return d.cached.includes(tier) ? `${t.name} · ready on this device` : `${t.name} · ${size}, downloaded once`;
}

/**
 * Speech models whose weights are in transformers.js's cache ("transformers-cache"):
 * both halves (encoder and decoder) of the model's repository. As the extension's
 * `cachedTiers`; the page keeps its own cache, the extension its own.
 */
export async function cachedTiers(store: CacheStorage | undefined = globalThis.caches): Promise<TierId[]> {
  try {
    if (!store) return [];
    const cache = await store.open("transformers-cache");
    const urls = (await cache.keys()).map((r) => r.url);
    return (Object.keys(TIERS) as TierId[]).filter(
      (id) => urls.filter((u) => u.includes(`/${TIERS[id].repo}/`) && /\.onnx(_data)?$/.test(u)).length >= 2,
    );
  } catch {
    return [];
  }
}
