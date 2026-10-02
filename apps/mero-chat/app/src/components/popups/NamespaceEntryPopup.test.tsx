import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeInvitationPayload,
  serializeGroupInvitationPayload,
} from "../../utils/invitation";
import type { SignedGroupOpenInvitation } from "../../api/groupApi";
import NamespaceEntryPopup from "./NamespaceEntryPopup";

// The popup's one decision worth pinning: whether a link invitation is acked.
// Acked on a join (or one the node already holds) and on a failure no retry can
// fix; kept on one that could pass, so the next load tries again.

const h = vi.hoisted(() => ({
  intent: null as null | {
    params: Record<string, string>;
    resolve: () => void;
  },
  // The shared redeemer's two calls (`useJoinInvitation().invitationRedeemer`),
  // the same on a node and on an account.
  join: vi.fn(),
  memberships: vi.fn(),
  // Stable across renders, as mero-react's is: the popup's loaders depend on it.
  admin: {
    getNodeIdentity: () => Promise.resolve({ accountId: "me" }),
  },
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ admin: h.admin }),
  useJoinInvitation: () => ({
    invitationRedeemer: () => ({ join: h.join, memberships: h.memberships }),
  }),
}));

// Replays the held intent on mount, as the SDK's pending-intent store does.
vi.mock("@calimero-network/mero-platform-react", () => ({
  useDeepLink: (handler: (intent: NonNullable<typeof h.intent>) => void) => {
    useEffect(() => {
      if (h.intent) handler(h.intent);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  },
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listGroups = () => Promise.resolve({ data: [], error: null });
    setGroupMetadata = () => Promise.resolve({ data: null, error: null });
    setMemberMetadata = () => Promise.resolve({ data: null, error: null });
    syncGroup = () => Promise.resolve({ data: null, error: null });
  },
}));

const failure = (status: number, message: string) =>
  Promise.reject(Object.assign(new Error(message), { status }));

function arrive() {
  const resolve = vi.fn();
  const invitation = {
    invitation: { group_id: "ns1" },
    inviter_signature: "sig",
  } as unknown as SignedGroupOpenInvitation;
  h.intent = {
    params: {
      invitation: encodeInvitationPayload(
        serializeGroupInvitationPayload({ invitation, groupAlias: "Team" }),
      ),
    },
    resolve,
  };
  render(
    <NamespaceEntryPopup isAuthenticated isConfigSet onLogout={() => {}} />,
  );
  return resolve;
}

beforeEach(() => {
  localStorage.clear();
  h.join.mockReset();
  h.memberships.mockReset().mockResolvedValue([]);
});

describe("NamespaceEntryPopup invitation link", () => {
  it("acks and asks for a name on a join", async () => {
    h.join.mockResolvedValue(undefined);
    const resolve = arrive();
    await screen.findByText("Join Team");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(h.join).toHaveBeenCalledTimes(1);
  });

  it("acks and goes in when the join failed but the node lists the workspace", async () => {
    h.join.mockImplementation(() => failure(500, "The request was aborted"));
    h.memberships.mockResolvedValue(["ns1"]);
    const resolve = arrive();
    await screen.findByText("Join Team");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(h.join).toHaveBeenCalledTimes(1);
  });

  it("acks a refused invitation and says why", async () => {
    h.join.mockImplementation(() => failure(409, "member was removed"));
    const resolve = arrive();
    await screen.findByText(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps the invitation when no one is online to let you in", async () => {
    h.join.mockImplementation(() => failure(503, "no peer available"));
    const resolve = arrive();
    await screen.findByText(/No one in this workspace is online/);
    await waitFor(() => expect(h.memberships).toHaveBeenCalled());
    expect(resolve).not.toHaveBeenCalled();
  });
});
