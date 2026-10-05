import { describe, expect, it, vi } from "vitest";
import type { AdminApiClient } from "@calimero-network/mero-js";
import { pickApplicationId, resolveApplicationId } from "./appId";

const OTHER_APP = { id: "SomeOtherAppId111111111111111111111111111111", package: "com.calimero.curb" };
const RELEASE = { id: "J7SPnKLUbvf166Z61X74JMyK4oDLyAzN98RehWJhNyrv", package: "com.calimero.mero-pixart" };
const DEV_INSTALL = { id: "DuaN713adUp9Mr8VN448U7vNeyhavfP3nVZVBWSyhCox", package: "com.calimero.mero-pixart" };

describe("pickApplicationId", () => {
  it("picks the install that carries our package", () => {
    expect(pickApplicationId([OTHER_APP, RELEASE])).toBe(RELEASE.id);
  });

  // A dev-signed build has a DIFFERENT id for the same code, and must resolve
  // just the same — there is no constant to pin.
  it("resolves a dev-signed install by package too", () => {
    expect(pickApplicationId([OTHER_APP, DEV_INSTALL])).toBe(DEV_INSTALL.id);
  });

  it("never returns another application's id when the node knows packages and ours is absent", () => {
    expect(pickApplicationId([OTHER_APP])).toBe("");
  });

  it("returns an empty string when the node has no apps at all", () => {
    expect(pickApplicationId([])).toBe("");
  });

  // A raw-wasm dev install files the app with no package, so matching cannot
  // succeed; the only app installed is then the best answer, not a refusal.
  it("falls back to the only app when no row carries a package", () => {
    expect(pickApplicationId([{ id: "bare-id" }])).toBe("bare-id");
  });
});

describe("resolveApplicationId", () => {
  it("asks the admin for the installed apps and matches by package", async () => {
    const admin = {
      listApplications: vi.fn(async () => ({ apps: [OTHER_APP, RELEASE] })),
    } as unknown as AdminApiClient;
    await expect(resolveApplicationId(admin)).resolves.toBe(RELEASE.id);
    expect(admin.listApplications).toHaveBeenCalledTimes(1);
  });
});
