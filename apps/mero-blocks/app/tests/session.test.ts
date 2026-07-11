import { beforeEach, describe, expect, it } from "vitest";
import {
  captureSessionFromHash,
  getAccessToken,
  getSession,
  hasConnection,
  resetSession,
} from "../src/net/session";

const HASH =
  "#node_url=http://localhost:2660&access_token=at-1&refresh_token=rt-1" +
  "&app-id=app-1&context_id=ctx-1&executor_public_key=pk-1&expires_at=999&dev_mode=1";

beforeEach(() => {
  localStorage.clear();
  resetSession();
  window.history.replaceState({}, "", "/");
});

describe("SSO session capture", () => {
  it("captures the full desktop hash and strips it", () => {
    window.location.hash = HASH;
    expect(captureSessionFromHash()).toBe(true);
    const s = getSession();
    expect(s.nodeUrl).toBe("http://localhost:2660");
    expect(s.contextId).toBe("ctx-1");
    expect(s.applicationId).toBe("app-1");
    expect(s.executorPublicKey).toBe("pk-1");
    expect(s.devMode).toBe(true);
    expect(getAccessToken()).toBe("at-1");
    expect(window.location.hash).toBe("");
    expect(hasConnection()).toBe(true);
  });

  it("tolerates the application_id spelling too", () => {
    window.location.hash =
      "#node_url=http://n&access_token=a&refresh_token=r&application_id=app-2";
    captureSessionFromHash();
    expect(getSession().applicationId).toBe("app-2");
  });

  it("ignores a hash without credentials", () => {
    window.location.hash = "#context_id=ctx-9";
    expect(captureSessionFromHash()).toBe(false);
    expect(hasConnection()).toBe(false);
  });

  it("stores tokens in the shared mero-tokens format", () => {
    window.location.hash = HASH;
    captureSessionFromHash();
    const tokens = JSON.parse(localStorage.getItem("mero-tokens")!);
    expect(tokens.access_token).toBe("at-1");
    expect(tokens.refresh_token).toBe("rt-1");
  });

  it("persists the session for hash-less refreshes", () => {
    window.location.hash = HASH;
    captureSessionFromHash();
    resetSession();
    window.location.hash = "";
    captureSessionFromHash(); // no hash — should restore from storage
    expect(getSession().contextId).toBe("ctx-1");
  });
});
