// A lens names people from namespace member metadata. The host used to keep the
// first name it ever read for an identity, so someone who renamed themselves
// stayed under the old name — and a listing in the `{ data }` shape named
// nobody, leaving `5926f2…1334` on every card.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memberNames } from "@calimero-apps/names";
import { nodeLensHosts, type NodeAdmin, type NodeRpc } from "./nodeHost";
import { hexToBase58 } from "./collector";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const rpc: NodeRpc = { execute: vi.fn() };

function adminWith(rows: () => unknown): NodeAdmin {
  return {
    getNodeIdentity: vi.fn().mockResolvedValue({ accountId: null, deviceId: null }),
    getContextGroup: vi.fn().mockResolvedValue("sub1"),
    listNamespaces: vi.fn().mockResolvedValue([{ namespaceId: "ns1" }]),
    listGroupMembers: vi.fn(async (g: string) => (g === "ns1" ? rows() : { members: [] })),
  };
}

beforeEach(() => memberNames.clear());
afterEach(() => vi.useRealTimers());

describe("nodeLensHosts – people's names", () => {
  it("names an account written in base58 from a hex member listing", async () => {
    const host = nodeLensHosts(rpc, adminWith(() => ({ members: [{ identity: HEX, name: "Sandi" }] })))("ctx1");
    expect(await host.name(hexToBase58(HEX))).toBe("Sandi");
    expect(await host.name(HEX)).toBe("Sandi");
  });

  it("reads a listing in the `{ data }` shape", async () => {
    const host = nodeLensHosts(rpc, adminWith(() => ({ data: [{ identity: HEX, name: "Sandi" }] })))("ctx1");
    expect(await host.name(HEX)).toBe("Sandi");
  });

  it("shows a rename once the listing goes stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let name = "Sandi";
    const host = nodeLensHosts(rpc, adminWith(() => ({ members: [{ identity: HEX, name }] })))("ctx1");
    expect(await host.name(HEX)).toBe("Sandi");
    name = "Sandi K";
    vi.setSystemTime(Date.now() + 120_000);
    expect(await host.name(HEX)).toBe("Sandi K");
  });

  it("is empty for someone nobody named", async () => {
    const host = nodeLensHosts(rpc, adminWith(() => ({ members: [] })))("ctx1");
    expect(await host.name(HEX)).toBe("");
  });
});
