import { useEffect, useRef, useState } from "react";
import {
  InvitationDialog,
  useInviteRedemption,
} from "@calimero-network/mero-react";
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
import { DM_CONTEXT_ALIAS_PREFIX } from "../../utils/dmContext";

// ── An invitation link, opened ───────────────────────────────────────────────
//
// An invitation reaches this app one way: its link is opened. The links page
// (or a cold desktop start) appends `?invitation=…` to this app's URL, and a
// running desktop sends a `deep-link` event; `main.tsx` primes the shared
// capture for both before React mounts.
//
// This prompt is mounted above the routes, so it answers on any page: on the
// workspace picker after login, and inside a workspace when the desktop hands
// over a link while the chat is open. It is mero-react's `InvitationDialog`:
// it asks first — joining gives someone else's workspace a new peer — and only
// joins on "Join".
//
// After the join it enters what was joined: straight into the chat when the
// user already has a display name, else into the picker's name step. Entering
// is a full page load (see `enterWorkspace`), which would take the dialog down
// mid-sync, so it waits for the dialog to close: once the workspace's channel
// list has been read here (`synced`), or the person chose to carry on.

/** How long to keep asking for the joined workspace's channels. */
const CHANNELS_READ_MS = 60_000;
const CHANNELS_RETRY_MS = 2_000;

interface Props {
  /** The session can join: a node and tokens. The invitation waits until then. */
  enabled: boolean;
}

export default function InvitationPrompt({ enabled }: Props) {
  const api = useRef(new GroupApiDataSource());
  /** What the join answered with; empty for `already-member`. */
  const joinedAs = useRef("");
  /** The namespace whose channel list has come back from the node. */
  const [readFor, setReadFor] = useState<string | null>(null);
  /** Going in, held until the dialog has closed. */
  const [pendingEnter, setPendingEnter] = useState<(() => void) | null>(null);

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
      setReadFor(null);
      setPendingEnter(null);
      void prepareJoined(api.current, namespaceId, teamName, joinedAs.current, () =>
        setReadFor(namespaceId),
      ).then((go) => setPendingEnter(() => go));
    },
  });

  const { state } = redemption;
  useEffect(() => {
    if (state.stage !== "idle" || !pendingEnter) return;
    setPendingEnter(null);
    pendingEnter();
  }, [state.stage, pendingEnter]);

  return (
    <InvitationDialog
      redemption={redemption}
      noun="workspace"
      appName="Mero Chat"
      synced={state.stage === "joined" && readFor === state.namespaceId}
    />
  );
}

/**
 * The join landed (or the node already held it): record what the workspace is
 * called and who we are in it, let it sync and read its channels, then hand
 * back how to go in.
 */
async function prepareJoined(
  api: GroupApiDataSource,
  namespaceId: string,
  teamName: string | undefined,
  joinedAs: string,
  onChannelsRead: () => void,
): Promise<() => void> {
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

  // The workspace's own data: its channels, as the sidebar reads them. Every
  // workspace starts with #general, so an empty list is the node not having
  // synced yet, not an empty workspace: keep asking until a channel is there.
  // A workspace from before #general can have none; after the deadline it
  // goes in anyway.
  const deadline = Date.now() + CHANNELS_READ_MS;
  for (;;) {
    const res = await api.listSubgroups(namespaceId).catch(() => null);
    const channels = (res && !res.error ? res.data ?? [] : []).filter(
      (sg) => !(sg.alias ?? "").startsWith(DM_CONTEXT_ALIAS_PREFIX),
    );
    if (channels.length > 0) {
      onChannelsRead();
      break;
    }
    if (Date.now() > deadline) {
      log.warn("InvitationPrompt", "channels of the joined workspace never read");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, CHANNELS_RETRY_MS));
  }

  return () => {
    // One display name serves every workspace: if it is chosen, go straight
    // in, as joining always did.
    const existingName = getMessengerDisplayName();
    if (existingName) {
      enterWorkspace(api, namespaceId, existingName, memberIdentity);
      return;
    }
    enterJoinedWorkspaceForName(namespaceId);
  };
}
