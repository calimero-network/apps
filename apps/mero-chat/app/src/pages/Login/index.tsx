import React, { useState } from "react";
import { useCalimero } from "../../api/calimero";
import { clearStoredSession, clearNamespaceReady } from "../../utils/session";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";
import { useNavigate } from "react-router-dom";
// The shared landing template (generated — scripts/landing), the same page
// every other app in the fleet renders.
import LandingPage from "../landing/LandingPage";
import SignInPopup from "./SignInPopup";
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

  // Connected — the workspace picker (its own fixed overlay) over the landing.
  return (
    <>
      <LandingPage isAuthenticated />
      <NamespaceEntryPopup
        isAuthenticated={isAuthenticated}
        isConfigSet={isConfigSet}
        onLogout={() => void handleLogout()}
      />
    </>
  );
}

export function UnauthenticatedLanding() {
  const [loginOpen, setLoginOpen] = useState(false);
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
