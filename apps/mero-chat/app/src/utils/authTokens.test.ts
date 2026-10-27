import { afterEach, describe, expect, it } from "vitest";
import { writeSession } from "@calimero-apps/cloud";

import { hasLiveSession } from "./authTokens";

afterEach(() => writeSession(null));

describe("hasLiveSession", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("is false when there is no session", () => {
    expect(hasLiveSession()).toBe(false);
  });

  it("is true for a session that has not expired (the auth flag may still lag)", () => {
    writeSession({ accountId: "a", sessionToken: "s", refreshToken: "r", expiresAt: now() + 3600 });
    expect(hasLiveSession()).toBe(true);
  });

  it("is false once the session has expired", () => {
    writeSession({ accountId: "a", sessionToken: "s", refreshToken: "r", expiresAt: now() - 60 });
    expect(hasLiveSession()).toBe(false);
  });

  it("is false for a tab's refresh-only stub until it is refreshed", () => {
    writeSession({ accountId: "a", sessionToken: "", refreshToken: "r", expiresAt: 0 });
    expect(hasLiveSession()).toBe(false);
  });
});
