import React from "react";
import { useMero, ConnectButton } from "@calimero-network/mero-react";
import { clearStoredSession, clearNamespaceReady } from "../../utils/session";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";
import { useNavigate } from "react-router-dom";
import LandingPage from "./LandingPage";
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
// No prefix-based preservation: per-identity username rows were retired
// in favor of the single global `chat-username` (preserved exactly above).
const CONNECT_PRESERVE_PREFIX: string[] = [];

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

  // Not connected yet — show landing with ConnectButton.
  // Wrap in a pointerDownCapture handler so stale localStorage is purged
  // (whitelist preserved) before the SDK button kicks off the auth flow.
  if (!isAuthenticated && !isConfigSet) {
    return (
      <LandingPage
        connectButton={
          <div onPointerDownCapture={clearStorageForConnect}>
            <ConnectButton />
          </div>
        }
      />
    );
  }

  // Connected — show namespace entry popup over the landing background
  return (
    <LandingPage>
      <NamespaceEntryPopup
        isAuthenticated={isAuthenticated}
        isConfigSet={isConfigSet}
        onLogout={() => void handleLogout()}
      />
    </LandingPage>
  );
}
