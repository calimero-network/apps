import { describe, expect, it } from "vitest";
import { getContextProfileSyncAction } from "./contextProfileSync";

describe("getContextProfileSyncAction", () => {
  it("requires a profile write when the context has no username yet", () => {
    expect(
      getContextProfileSyncAction({
        globalName: "Ronit",
        contextUsername: "",
      }),
    ).toBe("apply-global-name");
  });

  it("requires a profile write when the context username differs from the global name", () => {
    expect(
      getContextProfileSyncAction({
        globalName: "Ronit",
        contextUsername: "Other Name",
      }),
    ).toBe("apply-global-name");
  });

  it("skips the write when the context already matches the global name", () => {
    expect(
      getContextProfileSyncAction({
        globalName: "Ronit",
        contextUsername: "Ronit",
      }),
    ).toBe("ready");
  });
});
