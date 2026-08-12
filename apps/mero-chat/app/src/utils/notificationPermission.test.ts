import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureNotificationPermission } from "./notificationPermission";

type MockNotification = {
  permission: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
};

function setNotification(mock: MockNotification | undefined) {
  (globalThis as unknown as { Notification?: MockNotification }).Notification =
    mock;
}

describe("ensureNotificationPermission", () => {
  beforeEach(() => {
    localStorage.clear();
    setNotification(undefined);
  });

  it("requests permission when it has never been decided", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    setNotification({ permission: "default", requestPermission });

    await expect(ensureNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("only asks once across calls", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    setNotification({ permission: "default", requestPermission });

    await ensureNotificationPermission();
    await ensureNotificationPermission();

    // Re-prompting every load is useless (browsers ask once per origin) and
    // user-hostile.
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does nothing when permission is already granted", async () => {
    const requestPermission = vi.fn();
    setNotification({ permission: "granted", requestPermission });

    await expect(ensureNotificationPermission()).resolves.toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does nothing when permission was denied — script cannot re-prompt", async () => {
    const requestPermission = vi.fn();
    setNotification({ permission: "denied", requestPermission });

    await expect(ensureNotificationPermission()).resolves.toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("no-ops when the Notification API is absent", async () => {
    setNotification(undefined);
    await expect(ensureNotificationPermission()).resolves.toBeNull();
  });

  it("no-ops when requestPermission is missing (desktop shell polyfill)", async () => {
    setNotification({ permission: "default" });
    await expect(ensureNotificationPermission()).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error("nope"));
    setNotification({ permission: "default", requestPermission });

    await expect(ensureNotificationPermission()).resolves.toBeNull();
  });
});
