import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAccountMode,
  setAccountMode,
  setMeroJs,
} from "./meroJsClient";

vi.mock("@calimero-network/mero-react", () => ({
  RpcError: class extends Error {},
  getNodeUrl: () => "http://node.test",
}));

afterEach(() => {
  setAccountMode(false);
  setMeroJs(null);
  vi.restoreAllMocks();
});

describe("account mode", () => {
  it("is off until the bridge says the session is an account", () => {
    expect(isAccountMode()).toBe(false);
    setAccountMode(true);
    expect(isAccountMode()).toBe(true);
  });
});

describe("hasMeroJs", () => {
  it("says whether the provider has handed over a client", async () => {
    const { hasMeroJs, setMeroJs } = await import("./meroJsClient");
    setMeroJs(null);
    expect(hasMeroJs()).toBe(false);
    setMeroJs({ admin: {} as never, rpc: { execute: async () => undefined as never } });
    expect(hasMeroJs()).toBe(true);
    setMeroJs(null);
  });
});
