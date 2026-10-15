import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useMero } from "@calimero-network/mero-react";
import { InviteStatusBanner, useInviteRedemption } from "@calimero-apps/invite";
import { tokens as t } from "../theme";
import { APP_ROUTE } from "../config";
import { announceJoined } from "../hooks/joinedWorkspace";
import { inviteRedeemer, parseInviteToken } from "../utils/redeemInvite";

/** How long "Joined …" stays up once the workspace is open behind it. */
const JOINED_NOTICE_MS = 4_000;

/**
 * The invitation prompt, mounted at APP level — above the router's routes —
 * because an invitation link can land on any of them.
 *
 * A link reaches the app only by being opened: the cold-open URL, the
 * launcher's warm `deep-link` event or the PWA launch queue, all captured before
 * React mounted (see `auth/ssoBootstrap`). This offers it — "You have been
 * invited to “Platform team”. Join / Not now" — and joins only on the click,
 * because joining puts this node into someone else's workspace.
 *
 * It waits for a session: a visitor who is not signed in belongs on the landing
 * page first, and the capture holds the invitation across that, so the prompt
 * appears once they are in. After a join it opens the workspace (via
 * `announceJoined`, which `useWorkspace` acts on) on its issues.
 *
 * Floats above every pane and modal, the alias gate included. The shared banner
 * reads its colours from CSS custom properties; `Float` maps them onto the
 * app's tokens.
 */
export default function InvitationHost(): React.ReactElement | null {
  const { admin, isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  // `admin`, not `mero.admin` (apps#348): on an account `joinNamespace` is the
  // account admin's claim through the relay; the node route is a 403.
  const redeemer = useMemo(() => inviteRedeemer(admin), [admin]);

  const { state, accept, decline, retry, dismiss } = useInviteRedemption({
    parse: parseInviteToken,
    redeemer,
    onJoined: (namespaceId) => {
      announceJoined(namespaceId);
      navigate(APP_ROUTE);
    },
    enabled: isAuthenticated && !isLoading && !!admin,
  });

  const { stage } = state;
  useEffect(() => {
    if (stage !== "joined" && stage !== "already-member") return;
    const timer = setTimeout(dismiss, JOINED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [stage, dismiss]);

  if (stage === "idle") return null;
  return (
    <Float>
      <InviteStatusBanner
        state={state}
        noun="workspace"
        onAccept={accept}
        onDecline={decline}
        onRetry={retry}
        onDismiss={dismiss}
      />
    </Float>
  );
}

const Float = styled.div`
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  width: min(520px, calc(100vw - 32px));
  font-family: ${t.font.sans};
  --color-surface-2: ${t.color.panel};
  --color-border: ${t.color.edge};
  --color-text: ${t.color.text};
  --color-danger-surface: ${t.color.panel};
  --color-danger-border: ${t.color.dangerBorder};
  --color-danger-ink: ${t.color.urgent};
  & > [data-testid="invite-status"] {
    box-shadow: ${t.shadowFloat};
  }
`;
