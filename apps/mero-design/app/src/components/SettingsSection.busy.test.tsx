// "Your name in this team" used to lose a name typed on a busy machine.
//
// The field appears once the node has said who you are. When that render runs
// past React's time slice (a loaded CI runner, a slow phone), React runs the
// new field's effects in a later task, and a keystroke can land in between.
// The field used to copy the loaded name into its draft from an effect; that
// effect then ran with its stale view (not editing, no name yet), wiped the
// keystroke and left Save disabled. `SettingsSection.names.test.tsx` failed
// now and then on CI because of it.
//
// This file makes the machine that busy on purpose: rendering the field takes
// longer than a time slice, and React's scheduler (which queues its next task
// with `setImmediate` in Node) gets each task a few milliseconds late.

import { vi } from "vitest";

vi.hoisted(() => {
  // Before react-dom loads: the scheduler keeps the `setImmediate` it sees then.
  const late = (cb: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(cb, 5, ...args);
  (globalThis as unknown as { setImmediate: typeof late }).setImmediate = late;
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const self = "f".repeat(64);

vi.mock("../api/rpc", () => ({
  getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "f".repeat(64) }),
  listGroupMembers: vi.fn().mockResolvedValue({ members: [], teeMembers: [] }),
  rpcCall: vi.fn().mockResolvedValue([]),
  updateMemberRole: vi.fn(),
}));
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
const admin = {
  // The team's names are still loading: nothing re-renders the section while
  // the field's first effects wait for their task.
  listGroupMembers: vi.fn(() => new Promise(() => {})),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ applicationId: "app-1", admin }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn() }),
}));
vi.mock("../contexts/ToastContext", () => ({
  useToast: () => {
    // A slow render: longer than React's 5 ms time slice.
    const until = Date.now() + 10;
    while (Date.now() < until) {
      /* busy */
    }
    return { showToast: vi.fn() };
  },
}));

const SettingsSection = (await import("./SettingsSection")).default;

describe("SettingsSection – your name, on a busy machine", () => {
  it("keeps a name typed the moment the field appears", async () => {
    render(<SettingsSection type="team" id="ns1" name="Team" />);
    const input = await screen.findByTestId("your-name-input");
    fireEvent.change(input, { target: { value: "Sandi" } });
    // Let every late task run before looking at what is left in the field.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("your-name-input")).toHaveValue("Sandi");
    fireEvent.click(screen.getByTestId("your-name-save"));
    await vi.waitFor(() => expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", self, { name: "Sandi" }));
  });
});
