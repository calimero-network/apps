import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MeroJsBridge from "./MeroJsBridge";
import { getMeroJs, isDelegatedSession, setMeroJs } from "./meroJsClient";
import {
  getApplicationId,
  setResolvedApplicationId,
} from "../constants/config";

// The transport switch. mero-react decides what the session is; the bridge
// hands the rest of the app exactly that and nothing else — no node URL, no
// token, no `/admin-api/` route of its own. These tests pin what each kind of
// session yields to `getMeroJs()`.

const { ctx } = vi.hoisted(() => ({
  ctx: {
    mero: null as unknown,
    admin: null as unknown,
    isDelegated: false,
    applicationId: null as string | null,
  },
}));

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ctx,
  NoRelayError: class NoRelayError extends Error {
    constructor(call: string) {
      super(`no relay for ${call}`);
      this.name = "NoRelayError";
    }
  },
  getNodeUrl: () => "",
}));

describe("MeroJsBridge", () => {
  beforeEach(() => {
    ctx.mero = null;
    ctx.admin = null;
    ctx.isDelegated = false;
    ctx.applicationId = null;
    setMeroJs(null);
    setResolvedApplicationId(null);
    localStorage.clear();
  });

  afterEach(() => {
    setMeroJs(null);
    setResolvedApplicationId(null);
  });

  it("on a node login, hands out the node's admin and rpc, and leaves the app id to the node resolution", () => {
    const nodeAdmin = { getNodeIdentity: vi.fn() };
    const nodeRpc = { execute: vi.fn() };
    ctx.admin = nodeAdmin;
    ctx.mero = { rpc: nodeRpc, admin: nodeAdmin };
    ctx.isDelegated = false;
    // The provider knows the node's installed id too; a node keeps resolving
    // it from the URL / stored / build-time value, not from here.
    ctx.applicationId = "node-installed-id";
    localStorage.setItem("calimero-application-id", "stored-app-id");

    render(<MeroJsBridge>{null}</MeroJsBridge>);

    const client = getMeroJs();
    expect(client.admin).toBe(nodeAdmin);
    expect(client.rpc).toBe(nodeRpc);
    expect(client.isDelegated).toBe(false);
    expect(client.applicationId).toBeNull();
    expect(isDelegatedSession()).toBe(false);
    expect(getApplicationId()).toBe("stored-app-id");
  });

  it("on an account session, hands out the account admin and the delegated rpc, under the registry id", () => {
    // `useMero().admin` on a delegated session is mero-react's account admin
    // (relay reads, delegated writes); `mero.rpc` is the relay transport. The
    // raw client's own `admin` — the relay's NODE routes, which an account's
    // token cannot pass — must never be what the data sources get.
    const accountAdmin = { getNodeIdentity: vi.fn() };
    const relayNodeAdmin = { getNodeIdentity: vi.fn() };
    const delegatedRpc = { execute: vi.fn() };
    ctx.admin = accountAdmin;
    ctx.mero = { rpc: delegatedRpc, admin: relayNodeAdmin };
    ctx.isDelegated = true;
    ctx.applicationId = "registry-app-id";
    localStorage.setItem("calimero-application-id", "stored-app-id");

    render(<MeroJsBridge>{null}</MeroJsBridge>);

    const client = getMeroJs();
    expect(client.admin).toBe(accountAdmin);
    expect(client.admin).not.toBe(relayNodeAdmin);
    expect(client.rpc).toBe(delegatedRpc);
    expect(client.isDelegated).toBe(true);
    expect(client.applicationId).toBe("registry-app-id");
    expect(isDelegatedSession()).toBe(true);
    // Every `getApplicationId()` caller — channel and DM context creation,
    // the namespace filter — now runs under the registry id, not the stored
    // one a node install wrote.
    expect(getApplicationId()).toBe("registry-app-id");
  });

  it("on an account that has joined nothing yet, has an admin and an rpc that refuses rather than reaching a node", async () => {
    ctx.admin = { getNodeIdentity: vi.fn() };
    ctx.mero = null;
    ctx.isDelegated = true;
    ctx.applicationId = null;

    render(<MeroJsBridge>{null}</MeroJsBridge>);

    const client = getMeroJs();
    expect(client.isDelegated).toBe(true);
    await expect(
      client.rpc.execute({
        contextId: "c",
        method: "m",
        argsJson: {},
      } as never),
    ).rejects.toThrow(/no relay/);
    // Not "stored-app-id" and not the build-time default either: nothing is
    // known yet, and the node resolution would answer the wrong question.
    expect(client.applicationId).toBeNull();
  });

  it("hands out nothing before the provider has a session", () => {
    render(<MeroJsBridge>{null}</MeroJsBridge>);

    expect(() => getMeroJs()).toThrow();
    expect(isDelegatedSession()).toBe(false);
  });
});
