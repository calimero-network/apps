// Someone who never set a profile in this audience used to show as
// `5926f2…1334` — in the sidebar and on every byline — even when they had
// named themselves for the whole company (namespace member metadata).

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { MeView } from "../generated/UpdatesClient";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const admin = {
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: HEX, role: "Member", name: "Sandi" }] }),
};
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ admin, nodeUrl: null, logout: vi.fn() }),
  useNodeIdentity: () => ({ identity: null }),
}));
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getActiveNamespaceId: () => "ns1",
}));

const { default: SessionMenu } = await import("./SessionMenu");

const me = (name: string): MeView => ({ account: HEX, name, firm: "", is_admin: false, is_team: false, muted: [] });

describe("SessionMenu – company names", () => {
  it("falls back to the name set for the company before the account id", async () => {
    render(
      <MemoryRouter>
        <SessionMenu me={me("")} roleLabel={null} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Sandi")).toBeInTheDocument();
    expect(screen.queryByText("5926f2…1334")).not.toBeInTheDocument();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("keeps the profile name when there is one", () => {
    render(
      <MemoryRouter>
        <SessionMenu me={me("Ana")} roleLabel={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });
});
