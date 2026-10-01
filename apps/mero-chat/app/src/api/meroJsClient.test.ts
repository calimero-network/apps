import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadBlob,
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

describe("downloadBlob", () => {
  it("on an account, reads the blob through the admin client, scoped to the context", async () => {
    const bytes = new TextEncoder().encode("hi").buffer;
    const getBlob = vi.fn(async () => bytes);
    setAccountMode(true);
    setMeroJs({ admin: { getBlob } as never, rpc: {} as never });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const blob = await downloadBlob("b1", "c1");

    expect(await blob.text()).toBe("hi");
    expect(getBlob).toHaveBeenCalledWith("b1", { contextId: "c1" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on a node, keeps the node's own blob route", async () => {
    setMeroJs({ admin: {} as never, rpc: {} as never });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("node-bytes", { status: 200 }));

    const blob = await downloadBlob("b1", "c1");

    expect(await blob.text()).toBe("node-bytes");
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "http://node.test/admin-api/blobs/b1?context_id=c1",
    );
  });
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
