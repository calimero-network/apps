// An ACCOUNT (delegated) session has two admin clients in reach: the raw
// client's `mero.admin` — the relay's node route under the account's token,
// which answers 403 to a namespace create, a context create and a join — and
// `useMero().admin`, the account-aware client that routes each as the account
// can do it. These tests prove the data layer binds the second and never the
// first, for exactly the three calls that 403'd on prod.

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  isDelegated: true,
  rawAdmin: {
    createNamespace: vi.fn(),
    createContext: vi.fn(),
    joinNamespace: vi.fn(),
    joinContext: vi.fn(),
    listApplications: vi.fn(),
  },
  accountAdmin: {
    createNamespace: vi.fn(),
    createContext: vi.fn(),
    joinNamespace: vi.fn(),
    joinContext: vi.fn(),
    listApplications: vi.fn(),
    uploadBlob: vi.fn(),
    getBlob: vi.fn(),
  },
  execute: vi.fn(),
  applicationId: "registry-app-id",
}));

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({
    mero: {
      rpc: { execute: session.execute },
      admin: session.rawAdmin,
      events: null,
    },
    admin: session.accountAdmin,
    isDelegated: session.isDelegated,
    applicationId: session.applicationId,
    nodeUrl: null,
  }),
  setApplicationId: vi.fn(),
}));
vi.mock("../utils/blobCache", () => ({
  getCachedBlob: vi.fn().mockResolvedValue(null),
  setCachedBlob: vi.fn(),
}));

import { bindApi, getApi } from "./client";
import { ApiBinder } from "./ApiBinder";
import { createContext, createNamespace, joinContext, joinNamespace, rpcCall, uploadBlob } from "./rpc";
import { useApplicationId } from "../hooks/useApplicationId";

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  session.isDelegated = true;
  vi.stubGlobal("fetch", fetchSpy);
  render(<ApiBinder><span /></ApiBinder>);
});
afterEach(() => {
  bindApi(null);
  vi.unstubAllGlobals();
});

function expectRawUntouched() {
  for (const fn of Object.values(session.rawAdmin)) expect(fn).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("an account session binds the account-aware admin", () => {
  it("binds useMero().admin, not the raw client's admin", () => {
    const api = getApi();
    expect(api.isDelegated).toBe(true);
    expect(api.admin).toBe(session.accountAdmin);
    expect(api.admin).not.toBe(session.rawAdmin);
  });

  it("creates a namespace through the account admin, never the node route", async () => {
    session.accountAdmin.createNamespace.mockResolvedValue({
      namespaceId: "ns1", haEnabled: false, haError: "account not linked",
    });
    const created = await createNamespace("registry-app-id", "Design");
    expect(created).toEqual({ namespaceId: "ns1", haEnabled: false, haError: "account not linked" });
    expect(session.accountAdmin.createNamespace).toHaveBeenCalledWith({
      applicationId: "registry-app-id", name: "Design",
    });
    expectRawUntouched();
  });

  it("creates a context through the account admin, never the node route", async () => {
    session.accountAdmin.createContext.mockResolvedValue({ contextId: "c1", memberPublicKey: "" });
    const id = await createContext({
      applicationId: "registry-app-id", groupId: "g1", name: "Board", initializationParams: [],
    });
    expect(id).toBe("c1");
    expect(session.accountAdmin.createContext).toHaveBeenCalledTimes(1);
    expectRawUntouched();
  });

  it("joins via invitation through the account admin, never the node route", async () => {
    session.accountAdmin.joinNamespace.mockResolvedValue({ namespaceId: "ns1", memberIdentity: "acc" });
    session.accountAdmin.joinContext.mockResolvedValue({ contextId: "c1", memberPublicKey: "acc" });
    const invitation = { invitation: { group_id: [1, 2] }, inviterSignature: "sig" };
    await joinNamespace("ns1", invitation);
    await joinContext("c1");
    expect(session.accountAdmin.joinNamespace).toHaveBeenCalledWith("ns1", { invitation });
    expect(session.accountAdmin.joinContext).toHaveBeenCalledWith("c1");
    expectRawUntouched();
  });

  it("contract calls go through the session transport", async () => {
    session.execute.mockResolvedValue([{ id: "e1" }]);
    expect(await rpcCall("c1", "get_comments", {})).toEqual([{ id: "e1" }]);
    expect(session.execute).toHaveBeenCalledWith({ contextId: "c1", method: "get_comments", argsJson: {} });
    expectRawUntouched();
  });

  it("blob uploads carry the context the relay requires", async () => {
    session.accountAdmin.uploadBlob.mockResolvedValue({ blobId: "b1", size: 1 });
    await uploadBlob(new ArrayBuffer(1), "c1");
    expect(session.accountAdmin.uploadBlob).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: "c1" }),
    );
  });
});

describe("the application id on an account", () => {
  it("is the registry-derived one; the node listing is never asked for", async () => {
    let ensure: (() => Promise<string>) | null = null;
    function Probe() {
      ensure = useApplicationId();
      return null;
    }
    render(<Probe />);
    expect(await ensure!()).toBe("registry-app-id");
    expect(session.accountAdmin.listApplications).not.toHaveBeenCalled();
    expect(session.rawAdmin.listApplications).not.toHaveBeenCalled();
  });

  it("on a node login, asks the session's admin for the installed app by package", async () => {
    session.isDelegated = false;
    session.accountAdmin.listApplications.mockResolvedValue({
      apps: [{ id: "node-install", package: "com.calimero.mero-design" }],
    });
    let ensure: (() => Promise<string>) | null = null;
    function Probe() {
      ensure = useApplicationId();
      return null;
    }
    render(<Probe />);
    expect(await ensure!()).toBe("node-install");
    expect(session.accountAdmin.listApplications).toHaveBeenCalledTimes(1);
    expect(session.rawAdmin.listApplications).not.toHaveBeenCalled();
  });
});
