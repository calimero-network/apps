import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  PRODUCTION_APPLICATION_ID,
  pickApplicationId,
  resolveApplicationId,
} from "./appId";
import { adminGet } from "./rpc";

vi.mock("./rpc", () => ({ adminGet: vi.fn() }));

const mockAdminGet = vi.mocked(adminGet);

// The production id is pinned in source, so it wins whenever the node has it;
// otherwise resolution falls to package matching / apps[0]. VITE_APPLICATION_ID is
// no longer read at all — a stale hosting-project value must not be able to
// outrank what the node actually has.

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
    expect(pickApplicationId(apps)).not.toBe("other-app");
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

  it("prefers the pinned production id when the node has it", () => {
    const apps = [
      { id: "curb-app", package: "com.calimero.curb" },
      { id: PRODUCTION_APPLICATION_ID, package: "com.calimero.mero-design" },
    ];
    expect(pickApplicationId(apps)).toBe(PRODUCTION_APPLICATION_ID);
  });

  // The reason the constant is a preference and not an override: a dev-signed
  // build has a DIFFERENT id for the same code and must still resolve.
  it("falls back to the package match for a dev install with another id", () => {
    const apps = [
      { id: "curb-app", package: "com.calimero.curb" },
      { id: "dev-signed-id", package: "com.calimero.mero-design" },
    ];
    expect(pickApplicationId(apps)).toBe("dev-signed-id");
  });
});

describe("resolveApplicationId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches /applications and resolves by package", async () => {
    mockAdminGet.mockResolvedValue({
      apps: [
        { id: "curb-app", package: "com.calimero.curb" },
        { id: "mero-design-app", package: "com.calimero.mero-design" },
      ],
    } as never);
    const id = await resolveApplicationId();
    expect(mockAdminGet).toHaveBeenCalledWith("/applications");
    expect(id).toBe("mero-design-app");
  });

  it("handles the legacy `applications` array key", async () => {
    mockAdminGet.mockResolvedValue({
      applications: [{ id: "mero-design-app", package: "com.calimero.mero-design" }],
    } as never);
    expect(await resolveApplicationId()).toBe("mero-design-app");
  });

  it("returns empty string when the node has no apps", async () => {
    mockAdminGet.mockResolvedValue({ apps: [] } as never);
    expect(await resolveApplicationId()).toBe("");
  });
});
