// A poll's creator who never joined this context's roster used to show as
// `5926f2…1334`, even when they had named themselves for the namespace. And a
// name picked here stayed in this contract, invisible to every other app.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ME = "a".repeat(64);
const BOB = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";

const admin = {
  listGroupMembers: vi.fn().mockResolvedValue({
    members: [
      { identity: ME, role: "Admin", name: "Sandi" },
      { identity: BOB, role: "Member", name: "Bob" },
    ],
  }),
  getMemberMetadata: vi.fn().mockResolvedValue(null),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@calimero-network/mero-react", async (orig) => ({
  ...(await orig<typeof import("@calimero-network/mero-react")>()),
  useMero: () => ({ admin, mero: null }),
  useContextGroup: () => ({ groupId: "ns1", loading: false, error: null }),
  useSubscription: () => undefined,
}));

const client = {
  whoami: vi.fn().mockResolvedValue({ account: ME }),
  roster: vi.fn().mockResolvedValue([]),
  listPolls: vi.fn().mockResolvedValue([
    { poll_id: "p1", title: "Lunch", creator: BOB, phase: "Voting", created_at: 0, ballots: 0 },
  ]),
  setName: vi.fn().mockResolvedValue(undefined),
};
vi.mock("./useMeroVote", async (orig) => ({
  ...(await orig<typeof import("./useMeroVote")>()),
  useMeroVote: () => client,
}));

const { VotePanel } = await import("./VotePanel");

afterEach(cleanup);

describe("VotePanel – namespace names", () => {
  it("names a poll creator off the roster by their namespace name", async () => {
    render(<VotePanel contextId="ctx1" />);
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(screen.queryByText("5926f2…1334")).toBeNull();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("offers the namespace name and publishes a roster name namespace-wide", async () => {
    render(<VotePanel contextId="ctx1" />);
    const input = (await screen.findByLabelText("Your name")) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Sandi"));

    fireEvent.change(input, { target: { value: "Sandi K" } });
    fireEvent.click(screen.getByText("Join roster"));
    await waitFor(() => expect(client.setName).toHaveBeenCalledWith({ name: "Sandi K" }));
    expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", ME, { name: "Sandi K" });
  });
});
