import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppNotInstalledError,
  ApplicationIdPendingError,
  listInstalledAppIds,
  resolveInstalledAppId,
} from "./installedApps";

const { session, mockListApplications } = vi.hoisted(() => ({
  session: { isDelegated: false, applicationId: null as string | null },
  mockListApplications: vi.fn(),
}));

vi.mock("../api/meroJsClient", () => ({
  getMeroJs: () => ({
    isDelegated: session.isDelegated,
    applicationId: session.applicationId,
    admin: { listApplications: mockListApplications },
  }),
}));

vi.mock("../constants/config", () => ({
  getApplicationId: () => "configured-app-id",
}));

describe("resolveInstalledAppId", () => {
  beforeEach(() => {
    session.isDelegated = false;
    session.applicationId = null;
    mockListApplications.mockReset();
  });

  it("on a node, lists the installed applications through the session admin", async () => {
    mockListApplications.mockResolvedValue({
      apps: [{ id: "other-app" }, { id: "configured-app-id" }],
    });

    await expect(resolveInstalledAppId()).resolves.toBe("configured-app-id");
    await expect(listInstalledAppIds()).resolves.toEqual([
      "other-app",
      "configured-app-id",
    ]);
  });

  it("on a node, reports the configured app as not installed rather than substituting another", async () => {
    mockListApplications.mockResolvedValue({ apps: [{ id: "other-app" }] });

    await expect(resolveInstalledAppId()).rejects.toBeInstanceOf(
      AppNotInstalledError,
    );
  });

  it("on an account, answers the registry-derived id and never lists", async () => {
    // A relay's `/admin-api/applications` is not the account's to read, and
    // a node's installed id is not the one an account's contexts run under.
    session.isDelegated = true;
    session.applicationId = "registry-app-id";
    mockListApplications.mockRejectedValue(new Error("HTTP 403"));

    await expect(resolveInstalledAppId("configured-app-id")).resolves.toBe(
      "registry-app-id",
    );
    expect(mockListApplications).not.toHaveBeenCalled();
  });

  it("on an account, is inconclusive — never 'not installed' — until the registry has answered", async () => {
    session.isDelegated = true;
    session.applicationId = null;

    const pending = resolveInstalledAppId();
    await expect(pending).rejects.toBeInstanceOf(ApplicationIdPendingError);
    await expect(pending).rejects.not.toBeInstanceOf(AppNotInstalledError);
    expect(mockListApplications).not.toHaveBeenCalled();
  });
});
