import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  InvitationDialog,
  InvitationGate,
  useInviteRedemption,
  useMero,
} from "@calimero-apps/cloud";
import { APP_ROUTE } from "../config";
import { announceJoined } from "../hooks/joinedWorkspace";
import { inviteRedeemer, parseInviteToken } from "../utils/redeemInvite";

/**
 * The invitation prompt, mounted at APP level — above the router's routes —
 * because an invitation link can land on any of them.
 *
 * A link reaches the app only by being opened: the cold-open URL, the
 * launcher's warm `deep-link` event or the PWA launch queue, all captured before
 * React mounted (see `auth/ssoBootstrap`). mero-react's `InvitationDialog` asks
 * "Join “Platform team”?" and joins only on the click, because joining puts
 * this node into someone else's workspace.
 *
 * It waits for a session: a visitor who is not signed in belongs on the landing
 * page first, and the capture holds the invitation across that, so the prompt
 * appears once they are in. After a join it opens the workspace (via
 * `announceJoined`, which `useWorkspace` acts on) on its issues. The dialog then
 * holds "Syncing…" until `useWorkspace`'s `useJoinSync` sees the workspace's
 * repo list come back from the node.
 */
export default function InvitationHost(): React.ReactElement | null {
  const { admin, isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  // `admin`, not `mero.admin` (apps#348): on an account `joinNamespace` is the
  // account admin's claim through the relay; the node route is a 403.
  const redeemer = useMemo(() => inviteRedeemer(admin), [admin]);

  const redemption = useInviteRedemption({
    parse: parseInviteToken,
    redeemer,
    onJoined: (namespaceId) => {
      announceJoined(namespaceId);
      navigate(APP_ROUTE);
    },
    enabled: isAuthenticated && !isLoading && !!admin,
  });

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={parseInviteToken} noun="workspace" appName="Mero Issue Tracker" />
      <InvitationDialog
        redemption={redemption}
        noun="workspace"
        appName="Mero Issue Tracker"
      />
    </>
  );
}
