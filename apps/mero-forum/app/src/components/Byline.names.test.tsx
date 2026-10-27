// An author who never picked a nickname on this forum used to byline as
// `5926f2…1334`, even when they had named themselves for the whole space.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const admin = {
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: HEX, role: "Admin", name: "Sandi" }] }),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), useMero: () => ({ admin }) }));
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getActiveNamespaceId: () => "ns1",
}));

const { Byline } = await import("./PostCard");

describe("Byline – space names", () => {
  it("falls back to the name set for the space before the account id", async () => {
    render(<Byline account={HEX} authorName="" selfAccount={HEX} />);
    expect(await screen.findByText("Sandi")).toBeInTheDocument();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("keeps the forum nickname when there is one", () => {
    render(<Byline account={HEX} authorName="Ana" selfAccount={null} />);
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });
});
