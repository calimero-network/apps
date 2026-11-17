import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NoAppTeamError } from "@calimero-apps/connect";

const teams = vi.fn();

vi.mock("@calimero-apps/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/connect")>()),
  appInviteTeams: (...args: unknown[]) => teams(...args),
}));
vi.mock("../api/sessionContext", () => ({ useSignedIn: () => ({ client: {}, passkey: () => ({}), source: null }) }));
vi.mock("@calimero-network/mero-react", () => ({
  InviteDialog: (p: { open: boolean; teams?: string[]; uses?: number; labels?: { noun?: string; note?: string } }) =>
    p.open ? (
      <>
        <p data-testid="invite-dialog">{JSON.stringify(p.teams)}</p>
        <p data-testid="invite-extra">{`${p.uses}|${p.labels?.noun}|${p.labels?.note ?? ""}`}</p>
      </>
    ) : null,
}));

import TeamInviteDialog from "./TeamInviteDialog";

afterEach(cleanup);

describe("TeamInviteDialog", () => {
  it("names the app team in the invite", async () => {
    teams.mockResolvedValue({ teams: ["team-1"], appOnly: false });
    render(<TeamInviteDialog teamId="org" open onClose={() => {}} />);
    expect((await screen.findByTestId("invite-dialog")).textContent).toBe('["team-1"]');
  });

  it("names the team, asks for single-use links and leaves the app-only note out of a legacy org", async () => {
    teams.mockResolvedValue({ teams: ["team-1"], appOnly: false });
    render(<TeamInviteDialog teamId="org" open onClose={() => {}} />);
    expect((await screen.findByTestId("invite-extra")).textContent).toBe("1|team|");
  });

  it("notes that a shared org's invite gives this app only", async () => {
    teams.mockResolvedValue({ teams: ["team-1"], appOnly: true });
    render(<TeamInviteDialog teamId="org" open onClose={() => {}} />);
    expect((await screen.findByTestId("invite-extra")).textContent).toBe(
      "1|team|Invites to Hyperfeed Pixart only: this organization's other apps are managed in Calimero Home.",
    );
  });

  it("falls back to an org-wide invite when the teams cannot be read", async () => {
    teams.mockRejectedValue(new Error("offline"));
    render(<TeamInviteDialog teamId="org" open onClose={() => {}} />);
    expect((await screen.findByTestId("invite-dialog")).textContent).toBe("[]");
  });

  it("closes instead of widening an org that has app teams but none for this app", async () => {
    teams.mockRejectedValue(new NoAppTeamError("com.calimero.mero-pixart"));
    const onClose = vi.fn();
    render(<TeamInviteDialog teamId="org" open onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
  });
});
