// A project's member rows used to show only an account id: project settings
// read names from the subgroup listing, which nobody writes. The name a person
// set for the team lives on the namespace, and every row should show it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const NS = "ab".repeat(32);
const SUB = "ef".repeat(32);
const ana = "a".repeat(64);

const listGroupMembers = vi.fn(async (groupId: string) =>
  groupId === NS
    ? { members: [{ identity: ana, role: "Member", name: "Ana" }] }
    : // The project subgroup: rows carry no names.
      { members: [{ identity: ana, role: "Member" }] },
);

vi.mock("../api/useApi", () => {
  const api = {
    admin: { listGroupMembers, updateMemberRole: vi.fn() },
    call: vi.fn().mockResolvedValue([]),
    getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "f".repeat(64) }),
  };
  return { useApi: () => api };
});
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
vi.mock("@calimero-network/mero-react", () => ({ useMero: () => ({ applicationId: "app-1" }) }));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const SettingsModal = (await import("./SettingsModal")).default;

describe("SettingsModal – member names", () => {
  it("names a project member from the team, not by their account id", async () => {
    render(<SettingsModal type="project" id="ctx1" groupId={SUB} namespaceId={NS} name="Poster" onClose={vi.fn()} />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(listGroupMembers).toHaveBeenCalledWith(NS);
    // The full id stays available to copy.
    expect(screen.getByTitle(ana)).toBeInTheDocument();
  });
});
