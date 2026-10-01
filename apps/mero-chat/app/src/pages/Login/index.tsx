import React, { useState } from "react";
import { useMero, ConnectButtonAccount } from "@calimero-network/mero-react";
import { clearStoredSession, clearNamespaceReady } from "../../utils/session";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";
import { useNavigate } from "react-router-dom";
// The shared landing template (generated — scripts/landing), the same page
// every other app in the fleet renders.
import LandingPage from "../landing/LandingPage";
import NamespaceEntryPopup from "../../components/popups/NamespaceEntryPopup";

declare global {
  interface Window {
    __TAURI_INVOKE__?: (cmd: string, args?: unknown) => Promise<unknown>;
  }
}

interface LoginProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
}

// The platform SDK's durable pending-intent store (PendingIntentStore) — a
// captured deep-link invitation lives here now, and MUST survive the Connect
// wipe so it can be replayed after the auth reload. Kept in sync with the
// STORAGE_KEY in @calimero-network/mero-platform's pending-intent module.
export const PLATFORM_PENDING_INTENTS_KEY = "calimero.platform.pendingIntents";

// Keys that survive a fresh Connect — node URL, display name, per-identity
// name cache, app id, workspace alias cache, and the PENDING INVITATION (so a
// deep-link invite isn't lost when the user logs in on the web). Everything
// else (tokens, group selection, sessions) is wiped to start auth clean.
//
// INVITATION_STORAGE_KEY is the retired hand-rolled buffer; kept here so any
// in-flight invite from a pre-migration session isn't dropped mid-upgrade.
export const CONNECT_PRESERVE_EXACT = new Set([
  "mero:node_url",
  "chat-username",
  "calimero-application-id",
  "calimero_group_aliases",
  INVITATION_STORAGE_KEY,
  PLATFORM_PENDING_INTENTS_KEY,
]);
// An account's durable state: its device keypair, the nonces its relays have
// seen and its relay map. Wiping it would mint a new device on every sign-in and
// replay nonces a relay already spent. Its session (sessionStorage) still goes.
const CONNECT_PRESERVE_PREFIX: string[] = ["calimero."];

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
  const { logout } = useMero();
  const navigate = useNavigate();

  const handleLogout = async () => {
    const nodeUrl = localStorage.getItem("mero:node_url");
    clearStoredSession();
    clearNamespaceReady();
    sessionStorage.clear();
    logout();
    if (nodeUrl) localStorage.setItem("mero:node_url", nodeUrl);
    if (window.__TAURI_INVOKE__) {
      try { await window.__TAURI_INVOKE__("close_current_window"); } catch { /* ignore */ }
    }
    navigate("/login");
  };

  // Not connected yet — the landing page. Its "Connect to node" opens the
  // sign-in popup, but through `onConnect`, so the stale-storage purge
  // (whitelist preserved) runs before the auth flow starts, as it always has.
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

/**
 * True when this tab is coming back from the wallet: the enrolment result (or
 * its refusal) is in the fragment. `ConnectButtonAccount` completes it on
 * mount, so the sign-in popup must already be open for it to run and for its
 * note (a cancelled or unverifiable enrolment) to be seen.
 */
function isEnrolmentReturn(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.has("credential") || params.has("error");
}

export function UnauthenticatedLanding() {
  const [loginOpen, setLoginOpen] = useState(isEnrolmentReturn);
  return (
    <>
      <LandingPage
        onConnect={() => {
          clearStorageForConnect();
          setLoginOpen(true);
        }}
      />
      {loginOpen && <SignInPopup onClose={() => setLoginOpen(false)} />}
    </>
  );
}

/**
 * Both sign-ins, where the shared template's popup offers only the node one:
 * "I run a node" (the node login) and "I have an account" (a relay, no node).
 */
function SignInPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0, 0, 0, 0.55)",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          color: "#131215",
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: "100%",
          display: "grid",
          gap: 16,
        }}
      >
        <ConnectButtonAccount />
        <button type="button" className="cal-lp-btn cal-lp-btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
