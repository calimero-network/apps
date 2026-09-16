import { beforeEach, describe, expect, it, vi } from "vitest";

const adminGet = vi.fn();
vi.mock("./rpc", () => ({ adminGet: (p: string) => adminGet(p) }));

import { accountId, loadAccountId, resetAccountId } from "./identity";

beforeEach(() => {
  resetAccountId();
  adminGet.mockReset();
});

const ACCOUNT = "a".repeat(64);

describe("loadAccountId", () => {
  it("reads the node's account from /identity", async () => {
    adminGet.mockResolvedValue({ accountId: ACCOUNT, publicKey: "b".repeat(64) });
    expect(await loadAccountId()).toBe(ACCOUNT);
    expect(adminGet).toHaveBeenCalledWith("/identity");
    expect(accountId()).toBe(ACCOUNT);
  });

  it("accepts the snake_case spelling too", async () => {
    adminGet.mockResolvedValue({ account_id: ACCOUNT });
    expect(await loadAccountId()).toBe(ACCOUNT);
  });

  it("caches, so the ownership check does not re-fetch per render", async () => {
    adminGet.mockResolvedValue({ accountId: ACCOUNT });
    await loadAccountId();
    await loadAccountId();
    expect(adminGet).toHaveBeenCalledTimes(1);
  });

  it("degrades to OWNING NOTHING when the route fails", async () => {
    // ⚠️ The direction of this failure is the point. An unknown account must
    // read as "" — which never equals an event's owner — so the UI hides Edit
    // and Delete. Falling back to any non-empty guess could match an event and
    // offer a control the contract will refuse.
    adminGet.mockRejectedValue(new Error("503"));
    expect(await loadAccountId()).toBe("");
    expect(accountId()).toBe("");
  });

  it("degrades the same way when the body has no account", async () => {
    adminGet.mockResolvedValue({ publicKey: "b".repeat(64) });
    expect(await loadAccountId()).toBe("");
  });

  it("trims whitespace", async () => {
    adminGet.mockResolvedValue({ accountId: `  ${ACCOUNT}  ` });
    expect(await loadAccountId()).toBe(ACCOUNT);
  });

  it("is NOT the publicKey", async () => {
    // The whole bug this module exists for: the device/signing key and the
    // account are both 64 hex characters, so nothing objects when the wrong one
    // is used — it simply never matches.
    const KEY = "b".repeat(64);
    adminGet.mockResolvedValue({ accountId: ACCOUNT, publicKey: KEY });
    expect(await loadAccountId()).not.toBe(KEY);
  });
});

describe("accountId", () => {
  it("is empty before anything loads it", () => {
    expect(accountId()).toBe("");
  });
});
