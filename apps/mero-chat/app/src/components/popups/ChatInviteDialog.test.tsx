import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { status: "signed-in"; client: object },
  getOrgRecord: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock("../../api/calimero", () => ({
  passkey: () => ({ id: "pk" }),
  useCalimero: () => ({ session: h.session }),
}));
vi.mock("../../api/platform", () => ({
  getOrgRecord: h.getOrgRecord,
  chatTeamId: (r: { team?: string }) => r.team ?? null,
  chatPackage: () => "pkg",
}));
vi.mock("../../utils/messengerName", () => ({ getMessengerDisplayName: () => "Alice" }));
vi.mock("@calimero-apps/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/connect")>()),
  isAppOnly: (r: { appOnly?: boolean }) => !!r.appOnly,
}));
vi.mock("@calimero-network/mero-react", () => ({
  InviteDialog: (p: { open: boolean }) => {
    h.dialog(p);
    return p.open ? <div>invite dialog</div> : null;
  },
}));

import ChatInviteDialog from "./ChatInviteDialog";

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { status: "signed-in", client: { id: "client" } };
  h.getOrgRecord.mockResolvedValue({ team: "team-chat" });
});

describe("ChatInviteDialog", () => {
  it("renders nothing while signed out", () => {
    h.session = null;
    render(<ChatInviteDialog groupId="org-1" open onClose={vi.fn()} />);
    expect(h.dialog).not.toHaveBeenCalled();
  });

  it("names Chat's app team, and links to the workspace", async () => {
    const onClose = vi.fn();
    render(<ChatInviteDialog groupId="org-1" open onClose={onClose} />);
    await screen.findByText("invite dialog");
    const props = h.dialog.mock.calls.at(-1)![0];
    expect(props).toMatchObject({
      org: "org-1",
      teams: ["team-chat"],
      appName: "Hyperfeed Chat",
      client: { id: "client" },
      passkey: { id: "pk" },
      onClose,
    });
    expect(new URL(props.linkBase).searchParams.get("org")).toBe("org-1");
  });

  it("names the inviter, and adds the this-app-only note only where the org keeps its apps apart", async () => {
    const { unmount } = render(<ChatInviteDialog groupId="org-1" open onClose={vi.fn()} />);
    await screen.findByText("invite dialog");
    let props = h.dialog.mock.calls.at(-1)![0];
    expect(props.inviterName).toBe("Alice");
    expect(props.labels.note).toBeUndefined();
    unmount();
    h.dialog.mockClear();
    h.getOrgRecord.mockResolvedValue({ team: "team-chat", appOnly: true });
    render(<ChatInviteDialog groupId="org-2" open onClose={vi.fn()} />);
    await waitFor(() => expect(h.dialog.mock.calls.at(-1)![0].labels.note).toMatch(/^Invites to Hyperfeed Chat only/));
    props = h.dialog.mock.calls.at(-1)![0];
    expect(props.labels.subtitle).not.toMatch(/only/);
  });

  it("invites org-wide when the workspace has no Chat team or cannot be read", async () => {
    h.getOrgRecord.mockResolvedValue({});
    const { unmount } = render(<ChatInviteDialog groupId="org-1" open onClose={vi.fn()} />);
    await waitFor(() => expect(h.dialog.mock.calls.at(-1)![0].teams).toEqual([]));
    unmount();
    h.dialog.mockClear();
    h.getOrgRecord.mockRejectedValue(new Error("down"));
    render(<ChatInviteDialog groupId="org-2" open onClose={vi.fn()} />);
    await waitFor(() => expect(h.dialog.mock.calls.at(-1)![0].teams).toEqual([]));
  });
});
