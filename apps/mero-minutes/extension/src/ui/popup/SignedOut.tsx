import { useState } from "react";
import type { Settings } from "../../lib/messages";
import { AlertIcon, LockIcon, Mark, Spinner } from "../icons";
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
      <button className="btn primary block lg" onClick={signIn} disabled={busy}>
        {busy ? <Spinner size={14} /> : null}
        {busy ? "Waiting for sign-in…" : "Sign in with Calimero"}
      </button>
      {error && (
        <div className="banner bad" role="alert">
          <AlertIcon size={14} />
          <span className="grow">{error}</span>
        </div>
      )}
      {settings.pageOverride && <p className="small muted center">Signing in on {settings.pageOverride}</p>}
      <p className="foot">
        <LockIcon size={13} />
        <span>Speech is transcribed on this laptop. Audio is never uploaded.</span>
      </p>
    </main>
  );
}
