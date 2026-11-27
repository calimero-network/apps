import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { signUpNotice } from "@calimero-apps/connect";
import type { SessionApi } from "./session";
import { SIGN_UP_CONFIRMING, SIGN_UP_READY } from "./signUpFlow";
import { SIGN_IN_HINT, noAccountCopy } from "./ceremony";

export { noAccountCopy };

/**
 * The part of the session the control drives. Everything past `busy`,
 * `error`, `signIn` and `signUp` is optional for an app that builds its own
 * session: without it, creating an account is always offered and a sign-up is
 * one button press.
 */
export type PasskeySignInApi = Pick<SessionApi, "busy" | "error" | "signIn" | "signUp"> &
  Partial<
    Pick<
      SessionApi,
      | "signUpAccess"
      | "passkeyUnknown"
      | "noAccountHere"
      | "stage"
      | "approve"
      | "cancelSignUp"
      | "hasInvite"
      | "knownAccount"
      | "inviteRefused"
      | "passkeyName"
    >
  >;

export interface PasskeySignInProps {
  api: PasskeySignInApi;
  /**
   * What an invite on this page joins, said on the buttons ("Create your
   * account and join {joining}"), e.g. "the team" or "Ada's workspace".
   * Whether there is an invite is the session's `hasInvite`; pass `invited`
   * to say so for a session that does not know.
   */
  joining?: string;
  /** The page holds an invite (overrides `api.hasInvite`). */
  invited?: boolean;
  /**
   * "Create an account" first asks for an optional label for the new passkey
   * ("Work laptop"), then "Create passkey" signs up. On by default: the label
   * leads the passkey's name in a password manager (with the app and the
   * cluster), so a person with several can tell them apart. It names only the
   * passkey, never the account. Off: "Create an account" signs up at once.
   */
  askLabel?: boolean;
  /**
   * Also ask the new account for an optional name on that step (the
   * account's own, which an app may show as the person's, e.g. in its people
   * lists). Off by default. With `askLabel` off, "Create an account" still
   * opens the step to ask it.
   */
  askName?: boolean;
  /** Replaces the one-line hint under the sign-in button (no invite). */
  hint?: ReactNode;
  className?: string;
}

/** Said before a sign-up starts: why the browser asks twice. */
export const SIGN_UP_TWO_PROMPTS = "Your browser asks twice: once to create a passkey, then once to approve with it.";

/** Said while the second prompt waits for its click; framework-free in `./signUpFlow`. */
export { SIGN_UP_READY };

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
 * The one way into every component app, for every state a visitor arrives in:
 *
 * - **Invite, no account here** (no account seen in this browser, or a
 *   sign-in just found none): "Create your account and join {joining}" is the
 *   only primary action and starts the sign-up with the invite. No sign-in is
 *   tried first; "I already have an account" is a link under it.
 * - **Invite, has an account**: "Join with your passkey". If that finds no
 *   account (the cluster does not know the passkey, or the prompt closed with
 *   none chosen), the panel switches in place to the create-account path,
 *   says so in one sentence, and keeps the invite.
 * - **No invite**: "Sign in with passkey", and "New here? Create an account"
 *   under it, disabled with the reason where the cluster's sign-up policy
 *   takes no account from this page.
 * - **Signing up**: the two browser prompts, back to back. Only when the
 *   browser refused the second at once (Safari's user-gesture rule, or a
 *   blocked prompt) does the button become "Approve with your new passkey",
 *   and the second prompt starts on that click.
 *
 * Errors are said in plain words with the next step; a dismissed prompt is a
 * quiet cancel. Themed by `--passkey-*` tokens, which fall back to glass.
 * A passkey the cluster has no account for is said in one line above "Create
 * an account" (or with why no account can be made here); that button stays the
 * only way to create one.
 *
 * - **Labelling the passkey** (after "Create an account"): an optional label,
 *   what the passkey will be saved as, "Create passkey" (which signs up) and
 *   "Back".
 *
 * Test ids: `signin-passkey`, `signup-passkey`, `signup-label`,
 * `signup-create`, `signup-back`, `signup-passkey-name`, `signup-approve`,
 * `signup-unavailable`, `signin-error`, `signin-switched`,
 * `signup-without-invite` (after a sign-up refused for its invite).
 */
export function PasskeySignIn({
  api,
  joining,
  invited,
  askLabel = true,
  askName = false,
  hint,
  className,
}: PasskeySignInProps) {
  const [running, setRunning] = useState<"in" | "up" | null>(null);
  /** "Create an account" was pressed: the label step shows. */
  const [labelling, setLabelling] = useState(false);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  /** An invited visitor chose "I already have an account". */
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const labelId = useId();
  const nameId = useId();
  const previewId = useId();
  const labelHintId = useId();
  const noticeId = useId();
  // Why this cluster takes no new account from this page (closed, or invite
  // only with no invite in hand): the create button stays, disabled, with it.
  const notice = signUpNotice(api.signUpAccess ?? "unknown");
  const canSignUp = notice === null;
  // A refused invite is no invite: the sign-up goes without it.
  const isInvited = (invited ?? api.hasInvite ?? false) && !api.inviteRefused;
  const stage = api.stage ?? null;
  const noAccount = api.noAccountHere ?? false;

  useEffect(() => {
    if (!api.busy) setRunning(null);
  }, [api.busy]);
  // A sign-up that ended with nothing to say (a closed prompt, Cancel) starts over;
  // one that failed stays on the label step with why.
  const signingUp = useRef(false);
  useEffect(() => {
    if (!signingUp.current || api.busy || stage !== null) return;
    signingUp.current = false;
    if (!api.error) {
      setLabelling(false);
      setLabel("");
      setName("");
    }
  }, [api.busy, stage, api.error]);
  // The label step takes focus where it opens.
  useEffect(() => {
    if (labelling) firstInput.current?.focus();
  }, [labelling]);
  // A sign-up refused for its invite goes back: the panel offers one without it.
  useEffect(() => {
    if (api.inviteRefused) setLabelling(false);
  }, [api.inviteRefused]);
  // A sign-in that found no account sends an invited visitor to sign-up.
  useEffect(() => {
    if (noAccount) setHasAccount(false);
  }, [noAccount]);

  const signIn = () => {
    setRunning("in");
    void api.signIn();
  };
  const signUp = () => {
    setRunning("up");
    signingUp.current = true;
    const passkeyLabel = askLabel ? label.trim() : "";
    void (passkeyLabel ? api.signUp(name.trim(), { passkeyLabel }) : api.signUp(name.trim()));
  };
  const create = () => {
    if (askLabel || askName) setLabelling(true);
    else signUp();
  };

  const rootClass = className ? `cp-passkey ${className}` : "cp-passkey";

  const errorLine = api.error && (
    <p className="cp-passkey__error" role="alert" data-testid="signin-error">
      <AlertIcon />
      <span>{api.error}</span>
    </p>
  );

  // A sign-up between its two prompts, or in one of them.
  if (stage !== null) {
    const ready = stage === "approve";
    return (
      <div className={rootClass} aria-busy={!ready}>
        {stage === "create" ? (
          <button type="button" className="cp-passkey__primary" data-testid="signup-passkey" disabled>
            <Spinner />
            <span>Create your passkey in the browser prompt…</span>
          </button>
        ) : (
          <button
            type="button"
            className="cp-passkey__primary"
            data-testid="signup-approve"
            disabled={!ready}
            onClick={() => api.approve?.()}
            autoFocus={ready}
          >
            {ready ? <PasskeyIcon /> : <Spinner />}
            <span>{ready ? "Approve with your new passkey" : "Approve in the browser prompt…"}</span>
          </button>
        )}
        <p className="cp-passkey__hint" role="status">
          {ready ? SIGN_UP_READY : stage === "create" ? SIGN_UP_TWO_PROMPTS : SIGN_UP_CONFIRMING}
        </p>
        {errorLine}
        {/* Also while a prompt is open: Cancel closes it (mero-js 29.7.7+). */}
        {api.cancelSignUp && (
          <button type="button" className="cp-passkey__link" data-testid="signup-cancel" onClick={() => api.cancelSignUp?.()}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  // After "Create an account": an optional label for the new passkey, then "Create passkey".
  if (labelling && canSignUp) {
    const shownAs = api.passkeyName?.((askLabel ? label.trim() : "") || name.trim()) ?? null;
    return (
      <div className={rootClass} aria-busy={api.busy}>
        <form
          className="cp-passkey__name"
          onSubmit={(e) => {
            e.preventDefault();
            signUp();
          }}
        >
          {askName && (
            <>
              <label htmlFor={nameId}>
                Your name <span className="cp-passkey__optional">(optional)</span>
              </label>
              <input
                id={nameId}
                ref={firstInput}
                data-testid="signup-name"
                value={name}
                maxLength={64}
                autoComplete="name"
                disabled={api.busy}
                onChange={(e) => setName(e.target.value)}
              />
            </>
          )}
          {askLabel && (
            <>
              <label htmlFor={labelId}>
                Label your passkey <span className="cp-passkey__optional">(optional)</span>
              </label>
              <input
                id={labelId}
                ref={askName ? undefined : firstInput}
                data-testid="signup-label"
                value={label}
                maxLength={32}
                autoComplete="off"
                placeholder="e.g. Work laptop"
                disabled={api.busy}
                aria-describedby={shownAs ? `${labelHintId} ${previewId}` : labelHintId}
                onChange={(e) => setLabel(e.target.value)}
              />
              <p className="cp-passkey__hint" id={labelHintId}>
                So you can tell your passkeys apart, e.g. Work laptop.
              </p>
            </>
          )}
          {shownAs && (
            <p className="cp-passkey__hint" id={previewId} data-testid="signup-passkey-name">
              Saved in your password manager as: <strong>{shownAs}</strong>
            </p>
          )}
          <button type="submit" className="cp-passkey__primary" data-testid="signup-create" disabled={api.busy}>
            {running === "up" ? <Spinner /> : <PasskeyIcon />}
            <span>{running === "up" ? "Creating your passkey…" : "Create passkey"}</span>
          </button>
        </form>
        <p className="cp-passkey__hint">{SIGN_UP_TWO_PROMPTS}</p>
        {errorLine}
        <button
          type="button"
          className="cp-passkey__link"
          data-testid="signup-back"
          disabled={api.busy}
          onClick={() => setLabelling(false)}
        >
          Back
        </button>
      </div>
    );
  }

  // An invited visitor who (as far as this browser knows) has no account here.
  if (isInvited && canSignUp && (hasAccount === false || (hasAccount === null && !api.knownAccount))) {
    return (
      <div className={rootClass} aria-busy={api.busy}>
        {noAccount && (
          <p className="cp-passkey__switched" role="status" data-testid="signin-switched">
            {noAccountCopy(joining, api.passkeyUnknown ?? false)}
          </p>
        )}
        <button
          type="button"
          className="cp-passkey__primary"
          data-testid="signup-passkey"
          disabled={api.busy}
          onClick={create}
        >
          {running === "up" ? <Spinner /> : <PlusIcon />}
          <span>{joining ? `Create your account and join ${joining}` : "Create your account and join"}</span>
        </button>
        <p className="cp-passkey__hint">{SIGN_UP_TWO_PROMPTS}</p>
        {api.error && !noAccount && errorLine}
        <button
          type="button"
          className="cp-passkey__link"
          data-testid="signin-passkey"
          disabled={api.busy}
          onClick={() => {
            setHasAccount(true);
            signIn();
          }}
        >
          {running === "in" ? "Waiting for your passkey…" : "Already have an account here? Join with your passkey"}
        </button>
      </div>
    );
  }

  // An invited visitor with an account here, or on a cluster an org invite
  // cannot create an account on (the reason is shown).
  if (isInvited) {
    return (
      <div className={rootClass} aria-busy={api.busy}>
        <button
          type="button"
          className="cp-passkey__primary"
          data-testid="signin-passkey"
          disabled={api.busy}
          onClick={signIn}
        >
          {running === "in" ? <Spinner /> : <PasskeyIcon />}
          <span>
            {running === "in" ? "Waiting for your passkey…" : joining ? `Join ${joining} with your passkey` : "Join with your passkey"}
          </span>
        </button>
        {errorLine}
        {canSignUp ? (
          <>
            <div className="cp-passkey__divider" role="presentation">
              <span>New here?</span>
            </div>
            <button
              type="button"
              className="cp-passkey__secondary"
              data-testid="signup-passkey"
              disabled={api.busy}
              onClick={() => {
                setHasAccount(false);
                create();
              }}
            >
              <PlusIcon />
              <span>Create an account and join</span>
            </button>
          </>
        ) : (
          <p className="cp-passkey__hint" id={noticeId} data-testid="signup-unavailable">
            {notice}
          </p>
        )}
      </div>
    );
  }

  const unknownFirst = Boolean(api.error && api.passkeyUnknown);
  return (
    <div className={rootClass} aria-busy={api.busy}>
      <button
        type="button"
        className="cp-passkey__primary"
        data-testid="signin-passkey"
        disabled={api.busy}
        onClick={signIn}
      >
        {running === "in" ? <Spinner /> : <PasskeyIcon />}
        <span>{running === "in" ? "Waiting for your passkey…" : "Sign in with passkey"}</span>
      </button>
      <p className="cp-passkey__hint">{hint ?? SIGN_IN_HINT}</p>
      {/* A passkey this cluster does not know: said under sign-in, so the create button below is the way on. */}
      {unknownFirst && errorLine}

      <div className="cp-passkey__divider" role="presentation">
        <span>New here?</span>
      </div>

      <button
        type="button"
        className="cp-passkey__secondary"
        data-testid="signup-passkey"
        disabled={api.busy || !canSignUp}
        aria-describedby={notice ? noticeId : undefined}
        onClick={create}
      >
        {running === "up" ? <Spinner /> : <PlusIcon />}
        <span>{running === "up" ? "Creating your passkey…" : "Create an account"}</span>
      </button>

      <p className="cp-passkey__hint" id={noticeId} data-testid={notice ? "signup-unavailable" : undefined}>
        {notice ?? SIGN_UP_TWO_PROMPTS}
      </p>

      {!unknownFirst && errorLine}
      {api.inviteRefused && canSignUp && (
        <button
          type="button"
          className="cp-passkey__secondary"
          data-testid="signup-without-invite"
          disabled={api.busy}
          onClick={create}
        >
          <PlusIcon />
          <span>Create your account without the invite</span>
        </button>
      )}
    </div>
  );
}
