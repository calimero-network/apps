import { beforeEach, describe, expect, it, vi } from "vitest";

import { accountId, loadAccountId, resetAccountId } from "./identity";

const getNodeIdentity = vi.fn();
const admin = { getNodeIdentity };

beforeEach(() => {
  resetAccountId();
  getNodeIdentity.mockReset();
});

const ACCOUNT = "a".repeat(64);

describe("loadAccountId", () => {
  it("reads the session's account through the session-aware admin", async () => {
    // `admin.getNodeIdentity`, never a raw `GET /admin-api/identity`: on a
    // delegated session the raw route names the RELAY, the account admin names
    // the signed-in account.
    getNodeIdentity.mockResolvedValue({ accountId: ACCOUNT, publicKey: "b".repeat(64) });
    expect(await loadAccountId(admin)).toBe(ACCOUNT);
    expect(getNodeIdentity).toHaveBeenCalledTimes(1);
    expect(accountId()).toBe(ACCOUNT);
  });

  it("accepts the snake_case spelling too", async () => {
    getNodeIdentity.mockResolvedValue({ account_id: ACCOUNT });
    expect(await loadAccountId(admin)).toBe(ACCOUNT);
  });

  it("caches, so the ownership check does not re-fetch per render", async () => {
    getNodeIdentity.mockResolvedValue({ accountId: ACCOUNT });
    await loadAccountId(admin);
    await loadAccountId(admin);
    expect(getNodeIdentity).toHaveBeenCalledTimes(1);
  });

  it("degrades to OWNING NOTHING when the read fails", async () => {
    // ⚠️ The direction of this failure is the point. An unknown account must
    // read as "" — which never equals an event's owner — so the UI hides Edit
    // and Delete. Falling back to any non-empty guess could match an event and
    // offer a control the contract will refuse.
    getNodeIdentity.mockRejectedValue(new Error("503"));
    expect(await loadAccountId(admin)).toBe("");
    expect(accountId()).toBe("");
  });

  it("degrades the same way when the body has no account", async () => {
    getNodeIdentity.mockResolvedValue({ publicKey: "b".repeat(64) });
    expect(await loadAccountId(admin)).toBe("");
  });

  it("degrades the same way before the session is connected", async () => {
    expect(await loadAccountId(null)).toBe("");
    expect(getNodeIdentity).not.toHaveBeenCalled();
  });

  it("trims whitespace", async () => {
    getNodeIdentity.mockResolvedValue({ accountId: `  ${ACCOUNT}  ` });
    expect(await loadAccountId(admin)).toBe(ACCOUNT);
  });

  it("is NOT the publicKey", async () => {
    // The whole bug this module exists for: the device/signing key and the
    // account are both 64 hex characters, so nothing objects when the wrong one
    // is used — it simply never matches.
    const KEY = "b".repeat(64);
    getNodeIdentity.mockResolvedValue({ accountId: ACCOUNT, publicKey: KEY });
    expect(await loadAccountId(admin)).not.toBe(KEY);
  });
});

describe("accountId", () => {
  it("is empty before anything loads it", () => {
    expect(accountId()).toBe("");
  });
});
