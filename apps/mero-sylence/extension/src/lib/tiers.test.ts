import { describe, expect, it } from "vitest";
import { TIERS, fallingBehind, isEnglish, pickTier, resolveTier, stepDown, tierFits, whisperLanguage, type Capabilities } from "./tiers";
import { canImproveAfterCall, tierBlock } from "./tiers";

const caps = (c: Partial<Capabilities> = {}): Capabilities => ({
  webgpu: false,
  maxBufferSize: 0,
  deviceMemoryGb: 8,
  cores: 8,
  ...c,
});
const GPU = caps({ webgpu: true, maxBufferSize: 2 ** 31, cached: ["best"] });
const GPU_FIRST_RUN = caps({ webgpu: true, maxBufferSize: 2 ** 31 });

describe("model tiers", () => {
  it.each([
    ["a laptop with WebGPU and 8 GB, turbo downloaded", GPU, "en", "best"],
    ["the same before turbo is downloaded", GPU_FIRST_RUN, "en", "light"],
    ["before the download, in German", GPU_FIRST_RUN, "de", "balanced"],
    ["the same in German", GPU, "de", "best"],
    ["Brave with shields hiding WebGPU", caps(), "en", "light"],
    ["no WebGPU, another language", caps(), "fr", "balanced"],
    ["no WebGPU, language detected", caps(), "", "balanced"],
    ["WebGPU but 4 GB", caps({ webgpu: true, deviceMemoryGb: 4 }), "en", "ultralight"],
    ["WebGPU with small buffers", caps({ webgpu: true, maxBufferSize: 256 << 20 }), "en", "light"],
    ["a two-core machine", caps({ cores: 2 }), "en", "ultralight"],
    ["unknown memory, English", caps({ deviceMemoryGb: 0 }), "en", "ultralight"],
    ["low memory in Croatian", caps({ deviceMemoryGb: 2 }), "hr", "balanced"],
  ] as const)("%s → %s", (_what, c, lang, want) => {
    expect(pickTier(c, lang)).toBe(want);
  });

  it("only offers what fits", () => {
    expect(tierFits("best", caps(), "en")).toBe(false);
    expect(tierFits("best", GPU, "en")).toBe(true);
    expect(tierFits("light", GPU, "de")).toBe(false);
    expect(tierFits("balanced", caps(), "de")).toBe(true);
  });

  it("keeps a choice that fits and replaces one that doesn't", () => {
    expect(resolveTier("ultralight", GPU, "en")).toBe("ultralight");
    expect(resolveTier("best", caps(), "en")).toBe("light");
    expect(resolveTier("light", caps(), "de")).toBe("balanced");
    expect(resolveTier("auto", GPU, "en")).toBe("best");
  });

  it("steps down to a lighter model that still knows the language", () => {
    expect(stepDown("best", "en")).toBe("balanced");
    expect(stepDown("balanced", "en")).toBe("light");
    expect(stepDown("light", "en")).toBe("ultralight");
    expect(stepDown("ultralight", "en")).toBeNull();
    expect(stepDown("best", "de")).toBe("balanced");
    expect(stepDown("balanced", "de")).toBeNull();
  });

  it("knows when transcription falls behind", () => {
    expect(fallingBehind(10, 0.5)).toBe(false);
    expect(fallingBehind(60, 0.5)).toBe(true);
    expect(fallingBehind(5, 1.5)).toBe(true);
  });

  it("names languages and English", () => {
    expect(isEnglish("en-GB")).toBe(true);
    expect(isEnglish("")).toBe(false);
    expect(whisperLanguage("hr")).toBe("croatian");
    expect(whisperLanguage("")).toBeUndefined();
  });

  it("lists the standard model first, with honest sizes", () => {
    expect(TIERS.best.repo).toBe("onnx-community/whisper-large-v3-turbo");
    expect(TIERS.best.device).toBe("webgpu");
    expect(TIERS.ultralight.sizeMb).toBeLessThan(TIERS.light.sizeMb);
    expect(TIERS.light.sizeMb).toBeLessThan(TIERS.balanced.sizeMb);
  });
});

describe("what a device may run", () => {
  const strong = { webgpu: true, maxBufferSize: 4 * 2 ** 30, deviceMemoryGb: 8, cores: 10 };
  it("allows the big model only where every signal says it fits", () => {
    expect(tierBlock("best", strong)).toBeNull();
    expect(tierBlock("best", { ...strong, chromeOS: true })).toMatch(/Chromebook/);
    expect(tierBlock("best", { ...strong, deviceMemoryGb: 4 })).toMatch(/8 GB/);
    expect(tierBlock("best", { ...strong, deviceMemoryGb: 0 })).toMatch(/8 GB/);
    expect(tierBlock("best", { ...strong, cores: 4 })).toMatch(/cores/);
    expect(tierBlock("best", { ...strong, webgpu: false })).toMatch(/WebGPU/);
    expect(tierBlock("best", { ...strong, maxBufferSize: 256 * 2 ** 20 })).toMatch(/can't hold/);
  });
  it("keeps Whisper base off small machines and everything off phones", () => {
    expect(tierBlock("balanced", { ...strong, webgpu: false, deviceMemoryGb: 2 })).toMatch(/4 GB/);
    expect(tierBlock("balanced", { ...strong, cores: 2 })).toMatch(/cores/);
    expect(tierBlock("balanced", { ...strong, deviceMemoryGb: 0, cores: 0 })).toBeNull();
    expect(tierBlock("ultralight", { ...strong, deviceMemoryGb: 2, cores: 2 })).toBeNull();
    expect(tierBlock("ultralight", { ...strong, mobile: true })).toMatch(/Phones/);
  });
  it("never picks a model the device must not run, even when it is downloaded", () => {
    const chromebook = { ...strong, chromeOS: true, cached: ["best" as const] };
    expect(pickTier(chromebook, "en")).not.toBe("best");
    expect(resolveTier("best", chromebook, "en")).not.toBe("best");
    expect(pickTier({ ...strong, cached: ["best" as const] }, "en")).toBe("best");
  });
  it("unlocks the second pass only with the big model allowed and downloaded", () => {
    expect(canImproveAfterCall(null)).toBe(false);
    expect(canImproveAfterCall({ ...strong, cached: [] })).toBe(false);
    expect(canImproveAfterCall({ ...strong, cached: ["best"] })).toBe(true);
    expect(canImproveAfterCall({ ...strong, chromeOS: true, cached: ["best"] })).toBe(false);
  });
});
