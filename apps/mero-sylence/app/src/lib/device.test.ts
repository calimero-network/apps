import { describe, expect, it } from "vitest";
import { describeDevice, uploadPlan, type DeviceInfo } from "./device";

const strong: DeviceInfo = {
  webgpu: true,
  maxBufferSize: 4 * 2 ** 30,
  memoryGb: 8,
  cores: 10,
  chromeOS: false,
  mobile: false,
  gpu: "apple · metal-3",
  cached: [],
};

describe("uploadPlan", () => {
  it("never downloads the big model unasked", () => {
    expect(uploadPlan(strong)).toEqual({ ok: true, tier: "balanced", canBest: true, slow: false });
    expect(uploadPlan(strong, true)).toMatchObject({ ok: true, tier: "best" });
    expect(uploadPlan({ ...strong, cached: ["best"] })).toMatchObject({ ok: true, tier: "best" });
  });

  it("keeps a Chromebook with a GPU on the small model, even when asked", () => {
    const chromebook = { ...strong, chromeOS: true, memoryGb: 8, cores: 8 };
    expect(uploadPlan(chromebook, true)).toEqual({ ok: true, tier: "balanced", canBest: false, slow: true });
  });

  it("needs every signal for the big model: unknown memory counts as small", () => {
    expect(uploadPlan({ ...strong, memoryGb: 0 }, true)).toMatchObject({ tier: "balanced", canBest: false });
    expect(uploadPlan({ ...strong, maxBufferSize: 256 * 2 ** 20 }, true)).toMatchObject({ tier: "balanced", canBest: false });
    expect(uploadPlan({ ...strong, cores: 4 }, true)).toMatchObject({ tier: "balanced", canBest: false, slow: true });
    expect(uploadPlan({ ...strong, webgpu: false }, true)).toMatchObject({ tier: "balanced", canBest: false });
  });

  it("refuses phones and small machines", () => {
    expect(uploadPlan({ ...strong, mobile: true })).toMatchObject({ ok: false });
    expect(uploadPlan({ ...strong, memoryGb: 2 })).toMatchObject({ ok: false });
    expect(uploadPlan({ ...strong, cores: 2 })).toMatchObject({ ok: false });
  });

  it("allows an unknown-memory desktop on the small model", () => {
    expect(uploadPlan({ ...strong, webgpu: false, memoryGb: 0, cores: 0 })).toMatchObject({ ok: true, tier: "balanced" });
  });
});

describe("describeDevice", () => {
  it("names what the browser gave", () => {
    expect(describeDevice(strong)).toBe("8 GB+ memory · 10 cores · graphics: apple · metal-3");
    expect(describeDevice({ ...strong, webgpu: false, memoryGb: 4, cores: 4, chromeOS: true })).toBe("4 GB memory · 4 cores · no graphics acceleration · ChromeOS");
  });
});
