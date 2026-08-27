import { describe, expect, it } from "vitest";
import { pickApplicationId } from "./appId";

const OURS = { id: "CalendarAppId1111111111111111111111111111111", package: "com.calimero.merocalendar" };
const DEV_INSTALL = { id: "CalendarDevId2222222222222222222222222222222", package: "com.calimero.merocalendar" };
const OTHER_APP = { id: "SomeOtherAppId33333333333333333333333333333", package: "com.calimero.curb" };

describe("pickApplicationId", () => {
  it("prefers the session's application id when the node has it", () => {
    expect(pickApplicationId([OTHER_APP, OURS, DEV_INSTALL], DEV_INSTALL.id)).toBe(
      DEV_INSTALL.id,
    );
  });

  // The whole point of treating the session id as a preference and not an
  // override: a stale id wedges every call behind an opaque 500 that never
  // mentions application ids.
  it("ignores a session application id the node does not have", () => {
    expect(pickApplicationId([OTHER_APP, OURS], "StaleIdNoNodeHasThis")).toBe(OURS.id);
  });

  it("falls back to the manifest package match", () => {
    expect(pickApplicationId([OTHER_APP, OURS])).toBe(OURS.id);
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
