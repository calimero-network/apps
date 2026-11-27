import { useState } from "react";
import type { Settings } from "../../lib/messages";
import { AlertIcon, LockIcon, Mark, PlusIcon, Spinner } from "../icons";
import { ask } from "../rpc";

export function SignedOut({ settings, reason = null }: { settings: Settings; reason?: string | null }) {
  /** Which button is waiting for the sign-in window. */
  const [busy, setBusy] = useState<"in" | "up" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The new account's details, filled in here: the window then only asks for the passkey. */
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [ws, setWs] = useState("");
  const [label, setLabel] = useState("");

  // Both open Sylence's page, which signs in or makes the account with a passkey;
  // "Create an account" leads with making one, as the other Calimero apps do.
  const open = async (mode: "in" | "up") => {
    setBusy(mode);
    setError(null);
    try {
      await ask(
        mode === "up"
          ? { type: "signIn", intent: "signup", account: { name: name.trim(), label: label.trim(), ws: ws.trim() } }
          : { type: "signIn" },
      );
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
      {form ? (
        <form
          className="card stack"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (ws.trim()) void open("up");
          }}
        >
          <div className="field">
            <label htmlFor="su-name">Your name</label>
            <input id="su-name" className="input" autoFocus placeholder="e.g. Alex" maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="su-ws">Your first workspace</label>
            <input id="su-ws" className="input" placeholder="e.g. Product team" maxLength={80} value={ws} onChange={(e) => setWs(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="su-label">
              Label your passkey <span className="muted">(optional)</span>
            </label>
            <input id="su-label" className="input" placeholder="e.g. Work laptop" maxLength={32} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <button type="submit" className="btn primary block" disabled={busy !== null || !ws.trim()}>
            {busy === "up" ? <Spinner size={14} /> : null}
            {busy === "up" ? "Approve with your passkey…" : "Create account"}
          </button>
          <p className="small muted">A small window asks for your passkey, then closes.</p>
        </form>
      ) : (
        <button className="btn block lg" onClick={() => setForm(true)} disabled={busy !== null}>
          <PlusIcon size={14} /> Create an account
        </button>
      )}
      {error && (
        <div className="banner bad" role="alert">
          <AlertIcon size={14} />
          <span className="grow">{error}</span>
        </div>
      )}
      {settings.pageOverride && <p className="small muted center wrap">Signing in on {settings.pageOverride}</p>}
      <p className="foot">
        <LockIcon size={13} />
        <span>Transcribed on this laptop. The transcript and recording are saved to your workspace, sealed so only your team can read them.</span>
      </p>
    </main>
  );
}
