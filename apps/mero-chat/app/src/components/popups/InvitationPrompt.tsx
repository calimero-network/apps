import { useRef } from "react";
import { styled } from "styled-components";
import { InviteStatusBanner, useInviteRedemption } from "@calimero-apps/invite";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { getMeroJs } from "../../api/meroJsClient";
import {
  getGroupMemberIdentity,
  setGroupMemberIdentity,
  setStoredGroupAlias,
} from "../../constants/config";
import { getMessengerDisplayName } from "../../utils/messengerName";
import {
  groupInvitationRedeemer,
  parseInvitationToken,
} from "../../utils/redeemInvitation";
import {
  enterJoinedWorkspaceForName,
  enterWorkspace,
} from "../../utils/enterWorkspace";
import { log } from "../../utils/logger";

// ── An invitation link, opened ───────────────────────────────────────────────
//
// An invitation reaches this app one way: its link is opened. The links page
// (or a cold desktop start) appends `?invitation=…` to this app's URL, and a
// running desktop sends a `deep-link` event; `main.tsx` primes the shared
// capture for both before React mounts.
//
// This prompt is mounted above the routes, so it answers on any page: on the
// workspace picker after login, and inside a workspace when the desktop hands
// over a link while the chat is open. It asks first — joining gives someone
// else's workspace a new peer — and only joins on "Join".
//
// After the join it enters what was joined: straight into the chat when the
// user already has a display name, else into the picker's name step.

/** Above the workspace picker's own overlay, so it can be answered there. */
const Dock = styled.div`
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(32rem, calc(100vw - 2rem));
  z-index: 100000;
`;

interface Props {
  /** The session can join: a node and tokens. The invitation waits until then. */
  enabled: boolean;
}

export default function InvitationPrompt({ enabled }: Props) {
  const api = useRef(new GroupApiDataSource());
  /** What the join answered with; empty for `already-member`. */
  const joinedAs = useRef("");

  const redemption = useInviteRedemption({
    enabled,
    parse: (token) => parseInvitationToken(token),
    redeemer: groupInvitationRedeemer(
      {
        joinGroup: (request) => api.current.joinGroup(request),
        listNamespaces: () => getMeroJs().admin.listNamespaces(),
      },
      (memberIdentity) => {
        joinedAs.current = memberIdentity;
      },
    ),
    onJoined: (namespaceId, teamName) => {
      void enterJoined(api.current, namespaceId, teamName, joinedAs.current);
    },
  });

  const { state } = redemption;
  if (!enabled || state.stage === "idle") return null;

  return (
    <Dock>
      <InviteStatusBanner
        state={state}
        noun="workspace"
        onAccept={redemption.accept}
        onDecline={redemption.decline}
        onRetry={redemption.retry}
        onDismiss={redemption.dismiss}
        style={{
          background: "var(--glass-surface-solid)",
          boxShadow: "var(--chat-dialog-shadow)",
        }}
      />
    </Dock>
  );
}

/**
 * The join landed (or the node already held it): record what the workspace is
 * called and who we are in it, let it sync, then go in.
 */
async function enterJoined(
  api: GroupApiDataSource,
  namespaceId: string,
  teamName: string | undefined,
  joinedAs: string,
): Promise<void> {
  let memberIdentity = joinedAs;
  try {
    if (!memberIdentity) {
      const res = await api.resolveCurrentMemberIdentity(
        namespaceId,
        getGroupMemberIdentity(namespaceId),
      );
      memberIdentity = res.data?.memberIdentity ?? "";
    }
    setGroupMemberIdentity(namespaceId, memberIdentity);
    const alias = teamName?.trim();
    if (alias) {
      setStoredGroupAlias(namespaceId, alias);
      // Also publish it, so the name is the workspace's rather than this
      // browser's. Best-effort: a joiner usually lacks CAN_MANAGE_METADATA
      // and the node refuses, which is fine — the local alias still shows,
      // and whoever can write it will.
      void api.setGroupMetadata(namespaceId, alias).catch(() => {});
    }
    await api.syncGroup(namespaceId).catch(() => {});
  } catch (err) {
    // The join itself stands; entering only lacks a cached identity, which
    // the picker resolves again.
    log.warn("InvitationPrompt", "post-join bookkeeping failed", err);
  }

  // One display name serves every workspace: if it is chosen, go straight in,
  // as joining always did.
  const existingName = getMessengerDisplayName();
  if (existingName) {
    enterWorkspace(api, namespaceId, existingName, memberIdentity);
    return;
  }
  enterJoinedWorkspaceForName(namespaceId);
}
