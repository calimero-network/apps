import { TIERS, type TierId } from "./tiers";
import type { Capabilities } from "./tiers";

interface GpuLike {
  requestAdapter(): Promise<{ limits?: { maxBufferSize?: number } } | null>;
}

/** What this laptop can run, measured in a page (the popup or the offscreen document). */
export async function detectCaps(nav: Navigator = navigator): Promise<Capabilities> {
  const n = nav as Navigator & { gpu?: GpuLike; deviceMemory?: number };
  let webgpu = false;
  let maxBufferSize = 0;
  try {
    const adapter = n.gpu ? await n.gpu.requestAdapter() : null;
    if (adapter) {
      webgpu = true;
      maxBufferSize = adapter.limits?.maxBufferSize ?? 0;
    }
  } catch {
    webgpu = false;
  }
  return {
    webgpu,
    maxBufferSize,
    cached: await cachedTiers(),
    deviceMemoryGb: typeof n.deviceMemory === "number" ? n.deviceMemory : 0,
    cores: typeof n.hardwareConcurrency === "number" ? n.hardwareConcurrency : 0,
  };
}

/**
 * Tiers whose weights are in transformers.js's Cache Storage ("transformers-cache"),
 * judged by a cached file from the tier's repository. Empty where caches are unavailable.
 */
export async function cachedTiers(store: CacheStorage | undefined = globalThis.caches): Promise<TierId[]> {
  try {
    if (!store) return [];
    const cache = await store.open("transformers-cache");
    const urls = (await cache.keys()).map((r) => r.url);
    // Both halves of a model (its encoder and decoder) must be there.
    return (Object.keys(TIERS) as TierId[]).filter(
      (id) => urls.filter((u) => u.includes(`/${TIERS[id].repo}/`) && /\.onnx(_data)?$/.test(u)).length >= 2,
    );
  } catch {
    return [];
  }
}
