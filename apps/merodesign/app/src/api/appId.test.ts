import { vi, describe, it, expect, beforeEach } from "vitest";
import { pickApplicationId, resolveApplicationId } from "./appId";
import { adminGet } from "./rpc";

vi.mock("./rpc", () => ({ adminGet: vi.fn() }));

const mockAdminGet = vi.mocked(adminGet);

// Note: VITE_APPLICATION_ID is unset in the test env, so the env override is
// inactive and resolution falls to package matching / apps[0].

describe("pickApplicationId", () => {
  it("matches the app whose package is com.calimero.merodesign", () => {
    const apps = [
      { id: "curb-app", package: "com.calimero.curb" },
      { id: "merodesign-app", package: "com.calimero.merodesign" },
      { id: "kv-app", package: "com.calimero.kv-store" },
    ];
    expect(pickApplicationId(apps)).toBe("merodesign-app");
  });

  it("does not just return the first app when a later one matches", () => {
    const apps = [
      { id: "other-app", package: "com.calimero.other" },
      { id: "merodesign-app", package: "com.calimero.merodesign" },
    ];
    expect(pickApplicationId(apps)).not.toBe("other-app");
    expect(pickApplicationId(apps)).toBe("merodesign-app");
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
});

describe("resolveApplicationId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches /applications and resolves by package", async () => {
    mockAdminGet.mockResolvedValue({
      apps: [
        { id: "curb-app", package: "com.calimero.curb" },
        { id: "merodesign-app", package: "com.calimero.merodesign" },
      ],
    } as never);
    const id = await resolveApplicationId();
    expect(mockAdminGet).toHaveBeenCalledWith("/applications");
    expect(id).toBe("merodesign-app");
  });

  it("handles the legacy `applications` array key", async () => {
    mockAdminGet.mockResolvedValue({
      applications: [{ id: "merodesign-app", package: "com.calimero.merodesign" }],
    } as never);
    expect(await resolveApplicationId()).toBe("merodesign-app");
  });

  it("returns empty string when the node has no apps", async () => {
    mockAdminGet.mockResolvedValue({ apps: [] } as never);
    expect(await resolveApplicationId()).toBe("");
  });
});
