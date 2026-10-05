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
  joinGroup: vi.fn(),
  listNamespaces: vi.fn(),
  resolveCurrentMemberIdentity: vi.fn(),
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
  getNodeUrl: () => "http://localhost:2428",
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

vi.mock("../../api/meroJsClient", () => ({
  getMeroJs: () => ({
    admin: { listNamespaces: h.listNamespaces },
    isDelegated: false,
    applicationId: null,
  }),
  isDelegatedSession: () => false,
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listGroups = () => Promise.resolve({ data: [], error: null });
    joinGroup = h.joinGroup;
    resolveCurrentMemberIdentity = h.resolveCurrentMemberIdentity;
    setGroupMetadata = () => Promise.resolve({ data: null, error: null });
    setMemberMetadata = () => Promise.resolve({ data: null, error: null });
    syncGroup = () => Promise.resolve({ data: null, error: null });
  },
}));

const failure = (code: number, message: string) =>
  Promise.resolve({ data: null, error: { code, message } });

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
  h.joinGroup.mockReset();
  h.listNamespaces.mockReset().mockResolvedValue([]);
  h.resolveCurrentMemberIdentity
    .mockReset()
    .mockResolvedValue({ data: { memberIdentity: "me", members: [] } });
});

describe("NamespaceEntryPopup invitation link", () => {
  it("acks and asks for a name on a join", async () => {
    h.joinGroup.mockResolvedValue({
      data: { groupId: "ns1", memberIdentity: "me" },
    });
    const resolve = arrive();
    await screen.findByText("Join Team");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(h.joinGroup).toHaveBeenCalledTimes(1);
  });

  it("acks and goes in when the join failed but the node lists the workspace", async () => {
    h.joinGroup.mockReturnValue(failure(500, "The request was aborted"));
    h.listNamespaces.mockResolvedValue([{ namespaceId: "ns1" }]);
    const resolve = arrive();
    await screen.findByText("Join Team");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(h.joinGroup).toHaveBeenCalledTimes(1);
    // The join never answered, so the identity is looked up instead.
    expect(h.resolveCurrentMemberIdentity.mock.calls[0]?.[0]).toBe("ns1");
  });

  it("acks a refused invitation and says why", async () => {
    h.joinGroup.mockReturnValue(failure(409, "member was removed"));
    const resolve = arrive();
    await screen.findByText(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps the invitation when no one is online to let you in", async () => {
    h.joinGroup.mockReturnValue(failure(503, "no peer available"));
    const resolve = arrive();
    await screen.findByText(/No one in this workspace is online/);
    await waitFor(() => expect(h.listNamespaces).toHaveBeenCalled());
    expect(resolve).not.toHaveBeenCalled();
  });
});
