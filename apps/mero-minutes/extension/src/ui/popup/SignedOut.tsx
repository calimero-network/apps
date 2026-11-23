import { useState } from "react";
import { Lock } from "@calimero-network/mero-icons";
import type { Settings } from "../../lib/messages";
import { Mark, Spinner } from "../icons";
import { ask } from "../rpc";

export function SignedOut({ settings }: { settings: Settings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask({ type: "signIn" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="body">
      <div className="hero">
        <Mark size={52} />
        <div>
          <h1 className="title">Notes for every call</h1>
          <p className="subtitle">
            Minutes transcribes your Google Meet, Zoom and Teams calls and keeps the transcript and action items in your
            Calimero workspace.
          </p>
        </div>
      </div>
      <button className="btn primary block big" onClick={signIn} disabled={busy}>
        {busy ? <Spinner /> : null}
        {busy ? "Waiting for sign-in…" : "Sign in with Calimero"}
      </button>
      {error && (
        <div className="banner bad" role="alert">
          {error}
        </div>
      )}
      <div className="card small muted" style={{ display: "flex", gap: 10 }}>
        <Lock width={16} height={16} style={{ flex: "none", marginTop: 2 }} />
        <span>Speech is turned into text on this laptop. Audio is never uploaded; only the text is saved.</span>
      </div>
      {settings.pageOverride && <p className="small muted center">Signing in on {settings.pageOverride}</p>}
    </main>
  );
}
