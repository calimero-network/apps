import { useEffect, useId, useState, type ReactNode } from "react";
import type { SessionApi } from "./session";
import { AlertIcon, LifebuoyIcon, PasskeyIcon, PlusIcon, Spinner } from "./icons";
import { RecoverAccount } from "./RecoverAccount";

/**
 * The part of the session the control drives. With `recovery` (the whole
 * `usePasskeySession` result has it), it also offers "Lost your passkey?".
 */
export type PasskeySignInApi = Pick<SessionApi, "busy" | "error" | "signIn" | "signUp"> &
  Partial<Pick<SessionApi, "recovery">>;

export interface PasskeySignInProps {
  api: PasskeySignInApi;
  /**
   * Offer an optional name when creating a passkey. Off by default: a new
   * account needs nothing typed, and the app can ask for a display name later.
   */
  askName?: boolean;
  /** Replaces the one-line hint under the primary button. */
  hint?: ReactNode;
  className?: string;
}

/**
 * The one way into every component app: continue with a passkey the person
 * already has (from this app or any other Calimero app), or create one.
 * Nothing to install, no account to fill in. A dismissed browser prompt is a
 * quiet cancel. Themed by `--passkey-*` tokens, which fall back to glass.
 */
export function PasskeySignIn({ api, askName = false, hint, className }: PasskeySignInProps) {
  const [running, setRunning] = useState<"in" | "up" | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const nameId = useId();
  // A recovery this browser started opens on its status: the person came back to finish it.
  const [recovering, setRecovering] = useState(() => Boolean(api.recovery?.started));

  useEffect(() => {
    if (!api.busy) setRunning(null);
  }, [api.busy]);

  const signIn = () => {
    setRunning("in");
    void api.signIn();
  };
  const signUp = () => {
    setRunning("up");
    void api.signUp(name.trim());
  };
  const create = () => {
    if (askName && !naming) setNaming(true);
    else signUp();
  };

  const root = className ? `cp-passkey ${className}` : "cp-passkey";
  const recovery = api.recovery;

  if (recovery?.where && recovering) {
    return (
      <div className={root} aria-busy={api.busy}>
        <RecoverAccount api={{ busy: api.busy, error: api.error, recovery }} onBack={() => setRecovering(false)} />
      </div>
    );
  }

  return (
    <div className={root} aria-busy={api.busy}>
      <button
        type="button"
        className="cp-passkey__primary"
        data-testid="signin-passkey"
        disabled={api.busy}
        onClick={signIn}
      >
        {running === "in" ? <Spinner /> : <PasskeyIcon />}
        <span>{running === "in" ? "Waiting for your passkey…" : "Continue with passkey"}</span>
      </button>
      <p className="cp-passkey__hint">
        {hint ?? "Works with a passkey from any Calimero app. Nothing to install."}
      </p>

      <div className="cp-passkey__divider" role="presentation">
        <span>New here?</span>
      </div>

      {askName && naming && (
        <form
          className="cp-passkey__name"
          onSubmit={(e) => {
            e.preventDefault();
            signUp();
          }}
        >
          <label htmlFor={nameId}>
            Your name <span className="cp-passkey__optional">(optional)</span>
          </label>
          <input
            id={nameId}
            data-testid="signup-name"
            value={name}
            maxLength={64}
            autoComplete="name"
            autoFocus
            disabled={api.busy}
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      )}

      <button
        type="button"
        className="cp-passkey__secondary"
        data-testid="signup-passkey"
        disabled={api.busy}
        onClick={create}
      >
        {running === "up" ? <Spinner /> : <PlusIcon />}
        <span>{running === "up" ? "Creating your passkey…" : "Create a passkey"}</span>
      </button>

      {api.error && (
        <p className="cp-passkey__error" role="alert" data-testid="signin-error">
          <AlertIcon />
          <span>{api.error}</span>
        </p>
      )}

      {recovery?.where && (
        <button
          type="button"
          className="cp-passkey__link cp-passkey__lost"
          data-testid="recovery-open"
          disabled={api.busy}
          onClick={() => setRecovering(true)}
        >
          <LifebuoyIcon />
          <span>{recovery.started ? "Finish recovering your account" : "Lost your passkey? Use a recovery code"}</span>
        </button>
      )}
    </div>
  );
}
