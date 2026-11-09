import { useEffect, useId, useState, type ReactNode } from "react";
import { signUpNotice } from "@calimero-apps/connect";
import type { SessionApi } from "./session";

/**
 * The part of the session the control drives. `signUpAccess` and
 * `passkeyUnknown` are optional for an app that builds its own: without them,
 * creating an account is always offered, as before.
 */
export type PasskeySignInApi = Pick<SessionApi, "busy" | "error" | "signIn" | "signUp"> &
  Partial<Pick<SessionApi, "signUpAccess" | "passkeyUnknown">>;

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

const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

/** A key with a person: the passkey mark. */
function PasskeyIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 20v-1.2A5.3 5.3 0 0 1 7.8 13.5h2.4c.9 0 1.7.2 2.5.6" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M18 14.5V21l1.5-1.4L18 18.2l1.5-1.4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

function Spinner() {
  return <span className="cp-passkey__spinner" aria-hidden="true" />;
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
  const noticeId = useId();
  // Why this cluster takes no new account from this page (closed, or invite
  // only with no invite in hand): the create button stays, disabled, with it.
  const notice = signUpNotice(api.signUpAccess ?? "unknown");

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

  return (
    <div className={className ? `cp-passkey ${className}` : "cp-passkey"} aria-busy={api.busy}>
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
        disabled={api.busy || notice !== null}
        aria-describedby={notice ? noticeId : undefined}
        onClick={create}
      >
        {running === "up" ? <Spinner /> : <PlusIcon />}
        <span>{running === "up" ? "Creating your passkey…" : "Create a passkey"}</span>
      </button>

      {notice && (
        <p className="cp-passkey__hint" id={noticeId} data-testid="signup-unavailable">
          {notice}
        </p>
      )}

      {api.error && (
        <p className="cp-passkey__error" role="alert" data-testid="signin-error">
          <AlertIcon />
          <span>{api.error}</span>
        </p>
      )}
      {api.error && api.passkeyUnknown && notice === null && (
        <button
          type="button"
          className="cp-passkey__secondary"
          data-testid="signup-here"
          disabled={api.busy}
          onClick={create}
        >
          <PlusIcon />
          <span>Create an account here</span>
        </button>
      )}
    </div>
  );
}
