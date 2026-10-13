import { describe, expect, it } from "vitest";
import { deviceName, inputOf, keyBytes } from "./push";

describe("push", () => {
  it("decodes a base64url key, padded or not", () => {
    expect([...keyBytes("AQID-_8")]).toEqual([1, 2, 3, 251, 255]);
    expect([...keyBytes("AQID-_8=")]).toEqual([1, 2, 3, 251, 255]);
  });

  it("names a device from its user agent", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("Android");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("Mac");
    expect(deviceName("curl/8")).toBe("A device");
  });

  it("keeps a subscription's endpoint and keys, and refuses an incomplete one", () => {
    const sub = { endpoint: "https://push.example/x", keys: { p256dh: "BKey", auth: "secret" } };
    expect(inputOf(sub, "iPhone", true, "BRuntime")).toEqual({
      endpoint: "https://push.example/x",
      p256dh: "BKey",
      auth: "secret",
      name: "iPhone",
      quiet: true,
      key: "BRuntime",
    });
    expect(() => inputOf({ endpoint: "https://push.example/x" }, "", false, "k")).toThrow(/incomplete/);
  });
});
