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
    deviceMemoryGb: typeof n.deviceMemory === "number" ? n.deviceMemory : 0,
    cores: typeof n.hardwareConcurrency === "number" ? n.hardwareConcurrency : 0,
  };
}
