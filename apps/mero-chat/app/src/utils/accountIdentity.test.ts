import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { hexToBase58, loadSelfAccountIdentity } from "./accountIdentity";
import {
  clearRegisteredContextIdentities,
  isSelfSender,
} from "./selfIdentity";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "http://node.test",
  getContextIdentity: () => "",
}));
vi.mock("../api/meroJsClient", () => ({ getAuthConfig: () => ({ jwtToken: "t" }) }));
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
    vi.mocked(axios.get).mockReset();
    clearRegisteredContextIdentities();
  });

  it("reads the node-wide identity route, not the per-namespace one", async () => {
    // `/admin-api/namespaces/{id}/account` 404s on merod 0.11.0-rc.24. When it
    // did, nothing was registered as self and every ownership check silently
    // failed — the user could not edit or delete their own messages.
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { accountId: accountHex, deviceId: null } },
    });

    await loadSelfAccountIdentity("some-namespace");

    const url = vi.mocked(axios.get).mock.calls[0][0] as string;
    expect(url).toBe("http://node.test/admin-api/identity");
    expect(url).not.toContain("/namespaces/");
  });

  it("registers the base58 account id, which is what `sender` carries", async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { accountId: accountHex, deviceId: null } },
    });

    await loadSelfAccountIdentity();

    // The contract stamps `sender` with the base58 form; a message from this
    // node must now resolve as self.
    expect(isSelfSender(accountB58, "ctx-1")).toBe(true);
    expect(isSelfSender(accountHex, "ctx-1")).toBe(true);
    expect(isSelfSender("someone-else", "ctx-1")).toBe(false);
  });

  it("returns null and registers nothing when the node has no account id", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: {} } });

    await expect(loadSelfAccountIdentity()).resolves.toBeNull();
    expect(isSelfSender(accountB58, "ctx-1")).toBe(false);
  });
});
