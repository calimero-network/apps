import React, { useState, useSyncExternalStore } from "react";
import { useCalimero } from "../../api/calimero";
import { clearStoredSession, clearNamespaceReady } from "../../utils/session";
import {
  INVITATION_ORG_STORAGE_KEY,
  INVITATION_STORAGE_KEY,
  deferInvite,
  inviteDeferred,
  invitationInFlight,
  pendingInvite,
  subscribeInvite,
} from "../../utils/invitation";
import { useNavigate } from "react-router-dom";
// The shared landing template (generated — scripts/landing), the same page
// every other app in the fleet renders.
import LandingPage from "../landing/LandingPage";
import SignInPopup from "./SignInPopup";
import InvitationPage from "./InvitationPage";
import NamespaceEntryPopup from "../../components/popups/NamespaceEntryPopup";

interface LoginProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
}

// Keys that survive opening the sign-in: the display name, the workspace alias
// cache, and the PENDING INVITATION (so an opened invite link is not lost when
// the person signs up). The stored passkey session is per app and per target
// (`calimero-session:mero-chat:*`) and is kept too: signing in again replaces it.
export const CONNECT_PRESERVE_EXACT = new Set([
  "chat-username",
  "calimero_group_aliases",
  INVITATION_STORAGE_KEY,
  INVITATION_ORG_STORAGE_KEY,
]);
const CONNECT_PRESERVE_PREFIX: string[] = ["calimero-session:"];

export function clearStorageForConnect(): void {
  try {
    const keep: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const matchesPrefix = CONNECT_PRESERVE_PREFIX.some((p) => key.startsWith(p));
      if (CONNECT_PRESERVE_EXACT.has(key) || matchesPrefix) {
        const val = localStorage.getItem(key);
        if (val !== null) keep[key] = val;
      }
    }
    localStorage.clear();
    sessionStorage.clear();
    for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  } catch { /* ignore — storage may be unavailable */ }
}

export default function Login({ isAuthenticated, isConfigSet }: LoginProps) {
  const { logout } = useCalimero();
  const navigate = useNavigate();
  // An opened invitation is offered first (`InvitationPrompt`, above the
  // routes): the picker, a full-screen overlay, would cover it with "Create
  // workspace". It comes up once the invitation is joined, refused (and said),
  // or turned down.
  const inviting = useSyncExternalStore(subscribeInvite, invitationInFlight, invitationInFlight);

  const handleLogout = async () => {
    clearStoredSession();
    clearNamespaceReady();
    sessionStorage.clear();
    logout();
    navigate("/login");
  };

  // Not signed in yet — the landing page. Its "Connect" opens the passkey
  // sign-in, through `onConnect`, so the stale-storage purge (whitelist
  // preserved) runs before it.
  if (!isAuthenticated && !isConfigSet) {
    return <UnauthenticatedLanding />;
  }

  // Connected — the workspace picker (its own fixed overlay) over the landing,
  // unless an invitation is being offered.
  return (
    <>
      <LandingPage isAuthenticated />
      {!inviting && (
        <NamespaceEntryPopup
          isAuthenticated={isAuthenticated}
          isConfigSet={isConfigSet}
          onLogout={() => void handleLogout()}
        />
      )}
    </>
  );
}

/**
 * Signed out. With an invitation waiting, the invitation IS the page: no hero
 * behind it, no popup, no extra click. "Not now" comes back here to the
 * ordinary landing page, keeping the token for a later sign-in.
 */
export function UnauthenticatedLanding() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [deferred, setDeferred] = useState(() => inviteDeferred());
  // `/docs` and `/preview` render this signed in too: the prompt is theirs then.
  const { isAuthenticated } = useCalimero();
  if (!isAuthenticated && !deferred && pendingInvite() !== null) {
    return (
      <InvitationPage
        beforeCeremony={clearStorageForConnect}
        onNotNow={() => {
          deferInvite();
          setDeferred(true);
        }}
      />
    );
  }
  return (
    <>
      <LandingPage
        onConnect={() => {
          clearStorageForConnect();
          setLoginOpen(true);
        }}
      />
      <SignInPopup isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
