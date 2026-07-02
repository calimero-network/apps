// session.ts holds module-level state, so each test re-imports a fresh copy via
// vi.resetModules() + dynamic import.
import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionModule = typeof import("./session");

async function freshSession(hash: string): Promise<SessionModule> {
  vi.resetModules();
  window.location.hash = hash;
  const mod = await import("./session");
  mod.captureSessionFromHash();
  return mod;
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("captureSessionFromHash", () => {
  it("reads app id, room context, identity and dev mode from the hash", async () => {
    const s = await freshSession(
      "#app-id=app1&context_id=ctx1&executor_public_key=pk1&dev_mode=1",
    );
    expect(s.getApplicationId()).toBe("app1");
    expect(s.getContextId()).toBe("ctx1");
    expect(s.getExecutorPublicKey()).toBe("pk1");
    expect(s.isDeveloperMode()).toBe(true);
  });

  it("survives a refresh with no hash (persists the whole session)", async () => {
    await freshSession("#app-id=app1&context_id=ctx1&executor_public_key=pk1&dev_mode=1");
    // Refresh: MeroProvider already stripped the hash.
    const s = await freshSession("");
    expect(s.getApplicationId()).toBe("app1");
    expect(s.getContextId()).toBe("ctx1");
    expect(s.getExecutorPublicKey()).toBe("pk1");
    expect(s.isDeveloperMode()).toBe(true);
  });

  it("prefers fresh hash values over the persisted session (deep-link wins)", async () => {
    await freshSession("#app-id=app1&context_id=old-ctx&executor_public_key=old-pk");
    const s = await freshSession("#context_id=new-ctx&executor_public_key=new-pk");
    expect(s.getContextId()).toBe("new-ctx");
    expect(s.getExecutorPublicKey()).toBe("new-pk");
    // app id was absent from the new hash → kept from the persisted session.
    expect(s.getApplicationId()).toBe("app1");
  });

  it("restores the last room chosen in-app under the same app id", async () => {
    const first = await freshSession("#app-id=app1");
    first.setActiveRoom("room-ctx", "room-pk");
    const s = await freshSession("");
    expect(s.getContextId()).toBe("room-ctx");
    expect(s.getExecutorPublicKey()).toBe("room-pk");
  });
});

describe("username + room-name caches", () => {
  it("round-trips the username per app", async () => {
    const s = await freshSession("#app-id=app1");
    s.setUsername("Fran");
    expect(s.getUsername()).toBe("Fran");
  });

  it("ignores blank usernames", async () => {
    const s = await freshSession("#app-id=app1");
    s.setUsername("Fran");
    s.setUsername("   ");
    expect(s.getUsername()).toBe("Fran");
  });

  it("caches room names per context", async () => {
    const s = await freshSession("#app-id=app1");
    s.setRoomName("ctx9", "Standup");
    expect(s.getRoomName("ctx9")).toBe("Standup");
    expect(s.getRoomName("other")).toBe("");
  });
});
