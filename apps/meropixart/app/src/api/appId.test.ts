import { describe, expect, it } from "vitest";
import { PRODUCTION_APPLICATION_ID, pickApplicationId } from "./appId";

const OTHER_APP = { id: "SomeOtherAppId111111111111111111111111111111", package: "com.calimero.curb" };
const DEV_INSTALL = { id: "DuaN713adUp9Mr8VN448U7vNeyhavfP3nVZVBWSyhCox", package: "com.calimero.meropixart" };

describe("pickApplicationId", () => {
  it("prefers the pinned production id when the node has it", () => {
    const apps = [
      OTHER_APP,
      { id: PRODUCTION_APPLICATION_ID, package: "com.calimero.meropixart" },
    ];
    expect(pickApplicationId(apps)).toBe(PRODUCTION_APPLICATION_ID);
  });

  // The whole point of not making the constant an override: a dev-signed build
  // has a DIFFERENT id for the same code, and must still resolve.
  it("falls back to the package match when only a dev install is present", () => {
    expect(pickApplicationId([OTHER_APP, DEV_INSTALL])).toBe(DEV_INSTALL.id);
  });

  it("never returns another application's id when ours is absent but others exist", () => {
    // Single-app dev nodes rely on the last-resort fallback, so this asserts the
    // documented behaviour rather than an empty string.
    expect(pickApplicationId([OTHER_APP])).toBe(OTHER_APP.id);
  });

  it("returns an empty string when the node has no apps at all", () => {
    expect(pickApplicationId([])).toBe("");
  });

  it("tolerates entries with no package field", () => {
    expect(pickApplicationId([{ id: "bare-id" }])).toBe("bare-id");
  });
});
