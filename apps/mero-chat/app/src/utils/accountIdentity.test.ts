import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSelfAccount,
  getSelfAccountHex,
  hexToBase58,
  loadSelfAccountIdentity,
  sameAccount,
  toAccountBase58,
  toAccountHex,
} from "./accountIdentity";
import {
  clearRegisteredContextIdentities,
  isSelfSender,
} from "./selfIdentity";

const { mockGetNodeIdentity } = vi.hoisted(() => ({
  mockGetNodeIdentity: vi.fn(),
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextIdentity: () => "",
}));
// The session admin is the only thing identity reads. No node URL, no token:
// a raw `/admin-api/identity` read is what an account's token could not pass.
vi.mock("../api/meroJsClient", () => ({
  getMeroJs: () => ({
    admin: { getNodeIdentity: mockGetNodeIdentity },
    isDelegated: false,
    applicationId: null,
  }),
}));
vi.mock("../constants/config", () => ({
  getContextMemberIdentity: () => "",
  getGroupId: () => "",
  getGroupMemberIdentity: () => "",
}));

describe("hexToBase58", () => {
  it("matches the encoding the contract emits on `sender`", () => {
    // Captured from a live node: GET /admin-api/identity
    // returned this accountId (hex), and the WASM stamped the base58 form on
    // the message. The self-check failed because the app only ever held
    // device ids, which live in a different identifier space entirely.
    const accountHex =
      "007c24434c4c26b01c4f5425ec06b0db51d3f4bde4ed8c30d409552567c48cda";
    const senderBase58 = "12tnudNJsrM2URKkrUawd5PMyMHZkyZ8LAwoZWSYxYmX";

    expect(hexToBase58(accountHex)).toBe(senderBase58);
  });

  it("preserves leading zero bytes (they become leading '1's)", () => {
    // The captured account starts with 0x00 — dropping it would shift the
    // whole encoding and silently never match.
    expect(hexToBase58("007c24434c4c26b01c4f5425ec06b0db51d3f4bde4ed8c30d409552567c48cda")).toMatch(/^1/);
  });

  it("accepts a 0x prefix", () => {
    expect(hexToBase58("0x00")).toBe(hexToBase58("00"));
  });

  it("returns empty for malformed input", () => {
    expect(hexToBase58("")).toBe("");
    expect(hexToBase58("abc")).toBe("");
  });
});

describe("loadSelfAccountIdentity", () => {
  const accountHex =
    "baa372f40192959e17d8dd8c8ba93cd4483cb4cbf2c8527f11c4b4aabc3ab68b";
  const accountB58 = "DZZPSfWzipi1aH8YxjJop8eS3oJXUHaE5kbL67V6s3MU";

  beforeEach(() => {
    mockGetNodeIdentity.mockReset();
    clearRegisteredContextIdentities();
    clearSelfAccount();
  });

  it("asks the session admin for the identity, never a node route", async () => {
    // `getNodeIdentity` is the node-wide `/admin-api/identity` on a node and
    // the enrolled account on an account session. The app used to GET the
    // route itself with a node token; an account has no such token, so "me"
    // was never learned and every own message looked like someone else's.
    mockGetNodeIdentity.mockResolvedValue({ accountId: accountHex, deviceId: null });

    await expect(loadSelfAccountIdentity("some-namespace")).resolves.toBe(accountB58);

    expect(mockGetNodeIdentity).toHaveBeenCalledTimes(1);
    expect(getSelfAccountHex()).toBe(accountHex);
  });

  it("registers the base58 account id, which is what `sender` carries", async () => {
    mockGetNodeIdentity.mockResolvedValue({ accountId: accountHex, deviceId: null });

    await loadSelfAccountIdentity();

    // The contract stamps `sender` with the base58 form; a message from this
    // node must now resolve as self.
    expect(isSelfSender(accountB58, "ctx-1")).toBe(true);
    expect(isSelfSender(accountHex, "ctx-1")).toBe(true);
    expect(isSelfSender("someone-else", "ctx-1")).toBe(false);
  });

  it("registers the device id too when the node reports one", async () => {
    const deviceHex =
      "e8b65145da3670b152e06eb3e2c00a5b41ca8907aac0a4ef24486bffa6283670";
    mockGetNodeIdentity.mockResolvedValue({ accountId: accountHex, deviceId: deviceHex });

    await loadSelfAccountIdentity();

    expect(isSelfSender(deviceHex, "ctx-1")).toBe(true);
    expect(isSelfSender(hexToBase58(deviceHex), "ctx-1")).toBe(true);
  });

  it("returns null and registers nothing when the session has no account id", async () => {
    mockGetNodeIdentity.mockResolvedValue({});

    await expect(loadSelfAccountIdentity()).resolves.toBeNull();
    expect(isSelfSender(accountB58, "ctx-1")).toBe(false);
  });

  it("returns null rather than throwing when the admin refuses", async () => {
    mockGetNodeIdentity.mockRejectedValue(new Error("HTTP 403"));

    await expect(loadSelfAccountIdentity()).resolves.toBeNull();
    expect(getSelfAccountHex()).toBe("");
  });
});

describe("account id canonicalisation", () => {
  // Observed on a live rc.24 node: the SAME two members, served hex by the
  // admin API and base58 by the contract's `get_profiles`.
  const user1Hex = "e8b65145da3670b152e06eb3e2c00a5b41ca8907aac0a4ef24486bffa6283670";
  const user1B58 = "GfQq3fL5PC9Lw4fV3EAFQmoaoGyWMig2GvQgp3u3ZYeK";
  const user2Hex = "7528078a29c19803bbe1e370410b58992c0d1e436bec701ed33a4b3305bc916c";
  const user2B58 = "8tL6y7jzsTyff1UdKFzW67mMP91GGQCGSAzugpX6poKy";

  it("maps between the two encodings the app actually receives", () => {
    expect(hexToBase58(user1Hex)).toBe(user1B58);
    expect(toAccountHex(user1B58)).toBe(user1Hex);
    expect(toAccountBase58(user1Hex)).toBe(user1B58);
  });

  it("is idempotent, so a value can be canonicalised twice safely", () => {
    expect(toAccountHex(toAccountHex(user2B58))).toBe(user2Hex);
    expect(toAccountBase58(toAccountBase58(user2Hex))).toBe(user2B58);
  });

  it("recognises the same account across encodings", () => {
    // This is the comparison the self-DM guard makes. `===` returned false for
    // these two, so the guard never fired.
    expect(sameAccount(user1Hex, user1B58)).toBe(true);
    expect(sameAccount(user2B58, user2Hex)).toBe(true);
    expect(sameAccount(user1Hex, user2B58)).toBe(false);
  });

  it("passes through anything that is not a 32-byte account", () => {
    // Device keys, aliases and test placeholders must survive untouched —
    // converting is the helper's job, destroying is not.
    expect(toAccountHex("member-a")).toBe("member-a");
    expect(toAccountHex("")).toBe("");
    expect(sameAccount("", user1Hex)).toBe(false);
  });
});
