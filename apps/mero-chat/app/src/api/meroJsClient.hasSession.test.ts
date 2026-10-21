import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ nodeUrl: null as string | null }));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNodeUrl: () => h.nodeUrl,
}));

import { hasSession, setMeroJs, type ChatClient } from "./meroJsClient";

const client = (isDelegated: boolean) =>
  ({ admin: {}, rpc: { execute: vi.fn() }, isDelegated, applicationId: null }) as unknown as ChatClient;

afterEach(() => {
  h.nodeUrl = null;
  setMeroJs(null);
});

describe("hasSession", () => {
  it("is true on a node login", () => {
    h.nodeUrl = "http://localhost:2528";
    expect(hasSession()).toBe(true);
  });

  it("is true on an account session, which stores no node URL", () => {
    setMeroJs(client(true));
    expect(hasSession()).toBe(true);
  });

  it("is false with neither", () => {
    expect(hasSession()).toBe(false);
  });
});
