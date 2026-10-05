import { vi, describe, it, expect, beforeEach } from "vitest";
import { pickApplicationId, resolveApplicationId } from "./appId";

// The id is matched on the bundle's package. There is no pinned production id
// any more (it went stale with the signer) and VITE_APPLICATION_ID is not read
// at all — a stale hosting-project value must not outrank what the node has.

describe("pickApplicationId", () => {
  it("matches the app whose package is com.calimero.mero-design", () => {
    const apps = [
      { id: "curb-app", package: "com.calimero.curb" },
      { id: "mero-design-app", package: "com.calimero.mero-design" },
      { id: "kv-app", package: "com.calimero.kv-store" },
    ];
    expect(pickApplicationId(apps)).toBe("mero-design-app");
  });

  it("does not just return the first app when a later one matches", () => {
    const apps = [
      { id: "other-app", package: "com.calimero.other" },
      { id: "mero-design-app", package: "com.calimero.mero-design" },
    ];
    expect(pickApplicationId(apps)).toBe("mero-design-app");
  });

  it("falls back to the first app when no package matches", () => {
    const apps = [
      { id: "first-app", package: "com.calimero.other" },
      { id: "second-app", package: "com.calimero.another" },
    ];
    expect(pickApplicationId(apps)).toBe("first-app");
  });

  it("falls back to the first app when packages are missing (single-app dev node)", () => {
    expect(pickApplicationId([{ id: "only-app" }])).toBe("only-app");
  });

  it("returns empty string for an empty list", () => {
    expect(pickApplicationId([])).toBe("");
  });

  // A dev-signed build has a DIFFERENT id for the same code and must still resolve.
  it("resolves a dev install by package, whatever its id", () => {
    const apps = [
      { id: "curb-app", package: "com.calimero.curb" },
      { id: "dev-signed-id", package: "com.calimero.mero-design" },
    ];
    expect(pickApplicationId(apps)).toBe("dev-signed-id");
  });
});

describe("resolveApplicationId", () => {
  const listApplications = vi.fn();
  const admin = { listApplications };
  beforeEach(() => vi.clearAllMocks());

  it("lists the node's applications through the session's admin and resolves by package", async () => {
    listApplications.mockResolvedValue({
      apps: [
        { id: "curb-app", package: "com.calimero.curb" },
        { id: "mero-design-app", package: "com.calimero.mero-design" },
      ],
    });
    expect(await resolveApplicationId(admin)).toBe("mero-design-app");
    expect(listApplications).toHaveBeenCalledTimes(1);
  });

  it("handles the legacy `applications` array key and a bare array", async () => {
    listApplications.mockResolvedValue({
      applications: [{ id: "mero-design-app", package: "com.calimero.mero-design" }],
    });
    expect(await resolveApplicationId(admin)).toBe("mero-design-app");
    listApplications.mockResolvedValue([{ id: "bare", package: "com.calimero.mero-design" }]);
    expect(await resolveApplicationId(admin)).toBe("bare");
  });

  it("returns empty string when the node has no apps", async () => {
    listApplications.mockResolvedValue({ apps: [] });
    expect(await resolveApplicationId(admin)).toBe("");
  });
});
