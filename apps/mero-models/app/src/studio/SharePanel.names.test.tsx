// A member who never named themselves in this scene joined as "Guest", so the
// share panel listed "Guest", "Guest", "Guest" told apart only by account ids,
// and check-outs said "5926f2…" — even when they had named themselves for the
// namespace.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const admin = {
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: HEX, role: "Member", name: "Ana" }] }),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin, mero: null }),
  useContextGroup: () => ({ groupId: "ns1", loading: false, error: null }),
  useCreateNamespaceInvitation: () => ({ createNamespaceInvitation: vi.fn() }),
}));
const client = {
  getMembers: vi.fn().mockResolvedValue([{ id: HEX, name: "Guest", role: "viewer", joined_at: 0 }]),
};
vi.mock("../editor/hooks", async (orig) => ({
  ...(await orig<typeof import("../editor/hooks")>()),
  useModelsClient: () => client,
}));

const { SharePanel } = await import("./SharePanel");
const { nameOf } = await import("../editor/store");

describe("member names", () => {
  it("lists a member who joined as Guest by their namespace name", async () => {
    render(
      <SharePanel contextId="ctx1" name="" onName={vi.fn()} peers={[]} onFollow={vi.fn()} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("Guest")).not.toBeInTheDocument();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("names check-outs by scene name, then namespace name, then a short id", () => {
    const state = { me: "", memberNames: new Map([[HEX, "Guest"]]), spaceNameOf: () => undefined };
    expect(nameOf(state, HEX)).toBe("5926f2…1334");
    expect(nameOf({ ...state, spaceNameOf: () => "Ana" }, HEX)).toBe("Ana");
    expect(nameOf({ ...state, memberNames: new Map([[HEX, "Ana L"]]), spaceNameOf: () => "Ana" }, HEX)).toBe("Ana L");
  });
});
