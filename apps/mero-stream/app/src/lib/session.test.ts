import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// session.ts holds module-level mutable state (contextId, executorPublicKey,
// applicationId, devMode) that is populated once from the URL hash. So every test
// needs a FRESH module instance — `vi.resetModules()` plus a dynamic import —
// otherwise state leaks between cases and the suite passes for the wrong reason.
//
// Why this file is worth its length: session bootstrap is the single most
// load-bearing, least-visible piece of the app, and it is where sibling repos
// have repeatedly broken. Mero Chat read the URL after the SSO strip and picked
// up the wrong application id; foundation-app stripped the hash before the
// provider could read it. The mechanism under test here — hash first, then
// persisted session, then per-app last-stream fallback — is exactly that
// mechanism, and none of it had a test.

async function freshSession() {
  vi.resetModules();
  return await import("./session");
}

function setHash(hash: string): void {
  window.location.hash = hash;
}

beforeEach(() => {
  localStorage.clear();
  setHash("");
});

afterEach(() => {
  localStorage.clear();
  setHash("");
});

describe("captureSessionFromHash — reading the desktop's deep link", () => {
  it("reads the snake_case keys tauri-app actually sends", async () => {
    setHash(
      "#node_url=http://localhost:2428&access_token=tok&context_id=CTX1" +
        "&executor_public_key=PK1&app-id=APP1&dev_mode=1",
    );
    const s = await freshSession();
    s.captureSessionFromHash();
    expect(s.getContextId()).toBe("CTX1");
    expect(s.getExecutorPublicKey()).toBe("PK1");
    expect(s.getApplicationId()).toBe("APP1");
    expect(s.isDeveloperMode()).toBe(true);
  });

  it("also accepts the camelCase aliases", async () => {
    setHash("#contextId=CTX2&executorPublicKey=PK2&applicationId=APP2");
    const s = await freshSession();
    s.captureSessionFromHash();
    expect(s.getContextId()).toBe("CTX2");
    expect(s.getExecutorPublicKey()).toBe("PK2");
    expect(s.getApplicationId()).toBe("APP2");
  });

  it("treats any dev_mode value other than 1 as off", async () => {
    setHash("#app-id=APP&dev_mode=0");
    const s = await freshSession();
    s.captureSessionFromHash();
    expect(s.isDeveloperMode()).toBe(false);
  });

  it("leaves everything null when opened with no hash and nothing stored", async () => {
    const s = await freshSession();
    s.captureSessionFromHash();
    expect(s.getContextId()).toBeNull();
    expect(s.getExecutorPublicKey()).toBeNull();
    expect(s.getApplicationId()).toBeNull();
    expect(s.isDeveloperMode()).toBe(false);
  });
});

describe("captureSessionFromHash — surviving a refresh", () => {
  it("restores the session when the hash is gone (the actual refresh case)", async () => {
    // First open: the desktop passes everything in the hash, MeroProvider then
    // strips it. A plain reload therefore arrives with NO hash — without
    // persistence the app would render blank.
    setHash("#context_id=CTX&executor_public_key=PK&app-id=APP&dev_mode=1");
    const first = await freshSession();
    first.captureSessionFromHash();

    setHash("");
    const second = await freshSession();
    second.captureSessionFromHash();
    expect(second.getContextId()).toBe("CTX");
    expect(second.getExecutorPublicKey()).toBe("PK");
    expect(second.getApplicationId()).toBe("APP");
    expect(second.isDeveloperMode()).toBe(true);
  });

  it("lets a fresh deep link win over the persisted session", async () => {
    setHash("#context_id=OLD&executor_public_key=OLDPK&app-id=APP");
    const first = await freshSession();
    first.captureSessionFromHash();

    // Opening a DIFFERENT stream from the desktop must navigate there, not
    // silently reopen the previous one.
    setHash("#context_id=NEW&executor_public_key=NEWPK&app-id=APP");
    const second = await freshSession();
    second.captureSessionFromHash();
    expect(second.getContextId()).toBe("NEW");
    expect(second.getExecutorPublicKey()).toBe("NEWPK");
  });

  it("keeps persisted values the new hash does not mention", async () => {
    setHash("#context_id=CTX&executor_public_key=PK&app-id=APP");
    const first = await freshSession();
    first.captureSessionFromHash();

    // A hash carrying only tokens (no stream) must not wipe the active stream.
    setHash("#access_token=fresh");
    const second = await freshSession();
    second.captureSessionFromHash();
    expect(second.getContextId()).toBe("CTX");
    expect(second.getApplicationId()).toBe("APP");
  });

  it("ignores a corrupt session blob instead of throwing", async () => {
    localStorage.setItem("ms-session", "{not json");
    const s = await freshSession();
    expect(() => s.captureSessionFromHash()).not.toThrow();
    expect(s.getContextId()).toBeNull();
  });
});

describe("active stream selection", () => {
  it("persists a picked stream and restores it on the next open", async () => {
    setHash("#app-id=APP");
    const first = await freshSession();
    first.captureSessionFromHash();
    first.setActiveRoom("PICKED", "MYPK");
    expect(first.getContextId()).toBe("PICKED");

    setHash("");
    const second = await freshSession();
    second.captureSessionFromHash();
    expect(second.getContextId()).toBe("PICKED");
    expect(second.getExecutorPublicKey()).toBe("MYPK");
  });

  it("scopes the remembered stream per application id", async () => {
    // Two installs of the app must not restore each other's stream — the
    // wrong-app-id class of bug.
    setHash("#app-id=APP_A");
    const a = await freshSession();
    a.captureSessionFromHash();
    a.setActiveRoom("CTX_A", "PK_A");

    // A fresh open of a DIFFERENT app id, with no session blob to inherit from.
    localStorage.removeItem("ms-session");
    setHash("#app-id=APP_B");
    const b = await freshSession();
    b.captureSessionFromHash();
    expect(b.getContextId()).toBeNull();
  });

  it("clears the active stream so a dead context lands on the picker", async () => {
    // Without this, a context deleted on the node (or a node reset) means every
    // boot restores the dead stream and renders a dead page forever.
    setHash("#app-id=APP");
    const first = await freshSession();
    first.captureSessionFromHash();
    first.setActiveRoom("DEAD", "PK");
    first.clearActiveRoom();
    expect(first.getContextId()).toBeNull();

    setHash("");
    const second = await freshSession();
    second.captureSessionFromHash();
    expect(second.getContextId()).toBeNull();
  });

  it("ignores a half-written last-stream record", async () => {
    // Only restore when BOTH the context and the identity are present — a
    // context without an executor key cannot execute anything.
    setHash("#app-id=APP");
    const s = await freshSession();
    s.captureSessionFromHash();
    localStorage.setItem("ms-stream:APP", JSON.stringify({ ctx: "CTX" }));
    localStorage.removeItem("ms-session");

    const again = await freshSession();
    setHash("#app-id=APP");
    again.captureSessionFromHash();
    expect(again.getContextId()).toBeNull();
  });
});

describe("name caches", () => {
  it("round-trips a stream name and trims it", async () => {
    const s = await freshSession();
    s.captureSessionFromHash();
    s.setRoomName("CTX", "  My Probe  ");
    expect(s.getRoomName("CTX")).toBe("My Probe");
  });

  it("returns an empty string for an unknown stream, never undefined", async () => {
    const s = await freshSession();
    expect(s.getRoomName("NOPE")).toBe("");
    expect(s.getUsername()).toBe("");
  });

  it("refuses to store blank names", async () => {
    const s = await freshSession();
    s.setRoomName("CTX", "   ");
    s.setUsername("   ");
    expect(s.getRoomName("CTX")).toBe("");
    expect(s.getUsername()).toBe("");
  });

  it("round-trips a username and trims it", async () => {
    const s = await freshSession();
    s.setUsername("  prober  ");
    expect(s.getUsername()).toBe("prober");
  });
});

describe("clocks", () => {
  it("nowSecs is whole seconds and nowMillis is milliseconds", async () => {
    const s = await freshSession();
    vi.spyOn(Date, "now").mockReturnValue(1_751_955_010_123);
    try {
      expect(s.nowMillis()).toBe(1_751_955_010_123);
      expect(s.nowSecs()).toBe(1_751_955_010);
      expect(Number.isInteger(s.nowSecs())).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("nowMillis keeps the sub-second detail nowSecs throws away", async () => {
    // This IS the reason encode_frame takes millis: §4 latency lands in the
    // hundreds-of-ms band, which nowSecs quantizes away entirely.
    const s = await freshSession();
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockReturnValue(1_000_000_400);
      const earlyMs = s.nowMillis();
      const earlySec = s.nowSecs();
      spy.mockReturnValue(1_000_000_900);
      expect(s.nowMillis() - earlyMs).toBe(500);
      expect(s.nowSecs() - earlySec).toBe(0); // 500ms of latency, invisible
    } finally {
      vi.restoreAllMocks();
    }
  });
});
