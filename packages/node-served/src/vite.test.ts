import { describe, expect, it } from "vitest";
import { assetTail } from "./vite";

describe("assetTail", () => {
  it("serves an asset asked for below a route from the root", () => {
    expect(assetTail("/spaces/assets/index-1.js")).toBe("/assets/index-1.js");
    expect(assetTail("/teams/7/projects/assets/a.css?x=1")).toBe("/assets/a.css?x=1");
  });

  it("leaves every other path alone", () => {
    for (const url of ["/assets/index-1.js", "/spaces/1", "/favicon.svg", "/"]) {
      expect(assetTail(url)).toBe(url);
    }
  });
});
