import { useState } from "react";
import type { Settings } from "../../lib/messages";
import { AlertIcon, LockIcon, Mark, PlusIcon, Spinner } from "../icons";
import { ask } from "../rpc";

export function SignedOut({ settings, reason = null }: { settings: Settings; reason?: string | null }) {
  /** Which button is waiting for the sign-in window. */
  const [busy, setBusy] = useState<"in" | "up" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both open Sylence's page, which signs in or makes the account with a passkey;
  // "Create an account" leads with making one, as the other Calimero apps do.
  const open = async (mode: "in" | "up") => {
    setBusy(mode);
    setError(null);
    try {
      await ask(mode === "up" ? { type: "signIn", intent: "signup" } : { type: "signIn" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="body">
      <div className="hero" style={{ padding: "24px 8px 8px" }}>
        <Mark size={44} />
        <div>
          <h1 className="title">Notes for every call</h1>
          <p className="subtitle">
            Transcribe Google Meet, Zoom and Teams calls. Transcripts and action items are saved to your Calimero
            workspace.
          </p>
        </div>
      </div>
      {reason && !error && (
        <div className="banner" role="status">
          <AlertIcon size={14} />
          <span className="grow">{reason}</span>
        </div>
      )}
      <button className="btn primary block lg" onClick={() => void open("in")} disabled={busy !== null}>
        {busy === "in" ? <Spinner size={14} /> : null}
        {busy === "in" ? "Waiting for sign-in…" : "Sign in with Calimero"}
      </button>
      <div className="divider-label" role="presentation">
        <span>New here?</span>
      </div>
      <button className="btn block lg" onClick={() => void open("up")} disabled={busy !== null}>
        {busy === "up" ? <Spinner size={14} /> : <PlusIcon size={14} />}
        {busy === "up" ? "Waiting for the sign-up page…" : "Create an account"}
      </button>
      {error && (
        <div className="banner bad" role="alert">
          <AlertIcon size={14} />
          <span className="grow">{error}</span>
        </div>
      )}
      {settings.pageOverride && <p className="small muted center wrap">Signing in on {settings.pageOverride}</p>}
      <p className="foot">
        <LockIcon size={13} />
        <span>Transcribed on this laptop, then saved to your workspace, sealed so only your team can read it.</span>
      </p>
    </main>
  );
}
