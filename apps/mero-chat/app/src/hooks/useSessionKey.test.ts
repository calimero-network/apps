import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nodeUrl: null as string | null,
  mero: { admin: null as unknown, isDelegated: false, applicationId: null as string | null },
}));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNodeUrl: () => h.nodeUrl,
  useMero: () => h.mero,
}));

import { useSessionKey } from "./useSessionKey";

beforeEach(() => {
  h.nodeUrl = null;
  h.mero = { admin: null, isDelegated: false, applicationId: null };
});

describe("useSessionKey", () => {
  it("is null until there is a client, whatever is in storage", () => {
    h.nodeUrl = "http://localhost:2528";
    expect(renderHook(() => useSessionKey()).result.current).toBeNull();
  });

  it("keys a node login by its URL", () => {
    h.nodeUrl = "http://localhost:2528";
    h.mero = { admin: {}, isDelegated: false, applicationId: null };
    expect(renderHook(() => useSessionKey()).result.current).toBe("node:http://localhost:2528");
  });

  it("keys an account by its application id, and waits for it", () => {
    // A node URL left from an earlier node login must not make an account
    // read as ready before its id lands.
    h.nodeUrl = "http://localhost:2528";
    h.mero = { admin: {}, isDelegated: true, applicationId: null };
    const { result, rerender } = renderHook(() => useSessionKey());
    expect(result.current).toBeNull();
    h.mero = { admin: {}, isDelegated: true, applicationId: "app1" };
    rerender();
    expect(result.current).toBe("account:app1");
  });

  it("changes when the session changes from a node to an account", () => {
    h.nodeUrl = "http://localhost:2528";
    h.mero = { admin: {}, isDelegated: false, applicationId: null };
    const { result, rerender } = renderHook(() => useSessionKey());
    const node = result.current;
    h.mero = { admin: {}, isDelegated: true, applicationId: "app1" };
    rerender();
    expect(result.current).not.toBe(node);
  });
});
