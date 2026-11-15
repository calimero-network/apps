import { describe, expect, it } from "vitest";

import { reviewRelease } from "./nodeChecks";

const PKG = "com.example.app";

describe("reviewRelease", () => {
  it("is the package and version the source names", () => {
    expect(reviewRelease({ package: PKG, version: "1.4.0" })).toEqual({ package: PKG, version: "1.4.0" });
  });

  it("is none for an unversioned source or a raw bundle, which have nothing signed to review", () => {
    expect(reviewRelease({ package: PKG })).toBeNull();
    expect(reviewRelease("bundle-hash")).toBeNull();
  });
});
