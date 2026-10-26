import { describe, expect, it } from "vitest";
import { appLabel, appOrigin } from "./appOrigin";

const HEX = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");

describe("appLabel", () => {
  it("is the application id as unpadded lowercase base32", () => {
    expect(appLabel(HEX)).toBe("aaaqeayeaudaocajbifqydiob4ibceqtcqkrmfyydenbwha5dypq");
    expect(appLabel("ff".repeat(32))).toBe("777777777777777777777777777777777777777777777777777q");
  });

  it("keeps leading zero bytes", () => {
    expect(appLabel(`0000${HEX.slice(0, 60)}`)).toBe(
      "aaaaaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqoq",
    );
  });

  it("refuses an id that is not 64 lowercase hex digits", () => {
    for (const id of ["abc", HEX.toUpperCase(), `${HEX}00`, "g".repeat(64)]) {
      expect(() => appLabel(id)).toThrow(/64 lowercase hex/);
    }
  });
});

describe("appOrigin", () => {
  it("is the app's host on the node's port", () => {
    expect(appOrigin({ serverPort: 2740, applicationId: HEX })).toBe(
      "http://aaaqeayeaudaocajbifqydiob4ibceqtcqkrmfyydenbwha5dypq.localhost:2740",
    );
  });
});
