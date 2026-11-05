import { useEffect, useId, useState } from "react";
import type { RecoveryApi, SessionApi } from "./session";
import { RECOVERY_DELAY_HOURS, formatWhen, timeLeft } from "./recovery";
import { AlertIcon, ArrowLeftIcon, ClockIcon, ExternalIcon, PasskeyIcon, ShieldIcon, Spinner } from "./icons";

/** The current time, re-read every `everyMs` so a countdown moves. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="cp-passkey__error" role="alert" data-testid="recovery-error">
      <AlertIcon />
      <span>{error}</span>
    </p>
  );
}

export type RecoverAccountApi = Pick<SessionApi, "busy" | "error"> & { recovery: RecoveryApi };

export interface RecoverAccountProps {
  api: RecoverAccountApi;
  /** Back to the sign-in buttons. */
  onBack: () => void;
}

/**
 * Signed out, every passkey lost: start a recovery with the code and a new
 * passkey, then wait out the delay and finish it. On a Calimero Cloud app the
 * recovery runs on Calimero Cloud's Passkeys page, so this links there.
 * Rendered by `<PasskeySignIn>` behind "Lost your passkey?".
 */
export function RecoverAccount({ api, onBack }: RecoverAccountProps) {
  const { recovery, busy, error } = api;
  const [code, setCode] = useState("");
  const [running, setRunning] = useState<"start" | "finish" | null>(null);
  const codeId = useId();
  const now = useNow();

  useEffect(() => {
    if (!busy) setRunning(null);
  }, [busy]);

  const back = (
    <button type="button" className="cp-passkey__link" data-testid="recovery-back" onClick={onBack} disabled={busy}>
      <ArrowLeftIcon />
      <span>Back to sign in</span>
    </button>
  );

  if (recovery.where?.kind === "console") {
    return (
      <div className="cp-recovery" data-testid="recovery-console">
        <h3 className="cp-recovery__title">Recover your account</h3>
        <p className="cp-recovery__text">
          Use the recovery code you saved for this account. For your safety, recovery runs on Calimero Cloud's
          Passkeys page, not inside an app: there you enter the code and create a new passkey.
        </p>
        <p className="cp-recovery__text">
          Your new passkey starts working {RECOVERY_DELAY_HOURS} hours later, unless one of the account's existing
          passkeys cancels it first. Then it signs you in here too.
        </p>
        <a
          className="cp-passkey__primary cp-recovery__open"
          data-testid="recovery-open-console"
          href={recovery.where.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalIcon />
          <span>Recover on Calimero Cloud</span>
        </a>
        {back}
      </div>
    );
  }

  const started = recovery.started;
  if (started) {
    const left = timeLeft(started.readyAt, now);
    return (
      <div className="cp-recovery" data-testid="recovery-pending">
        <div className="cp-recovery__status">
          <span className="cp-recovery__status-icon">
            <ClockIcon />
          </span>
          <div>
            <h3 className="cp-recovery__title">{left ? "Recovery in progress" : "Ready to finish"}</h3>
            <p className="cp-recovery__text" data-testid="recovery-ready-at">
              {left ? (
                <>
                  Your new passkey can sign in from <strong>{formatWhen(started.readyAt)}</strong>, in {left}.
                </>
              ) : (
                <>The waiting period ended on {formatWhen(started.readyAt)}. Finish with the passkey you created.</>
              )}
            </p>
          </div>
        </div>
        {left && (
          <ul className="cp-recovery__list">
            <li>Until then, anyone with one of this account's passkeys can cancel the recovery, and every signed-in device sees it.</li>
            <li>Come back to this page after that time and finish with your new passkey.</li>
          </ul>
        )}
        <p className="cp-recovery__note">
          Finishing signs you in and signs out every other session of the account. Started {formatWhen(started.startedAt)}.
        </p>
        <button
          type="button"
          className="cp-passkey__primary"
          data-testid="recovery-finish"
          disabled={busy || Boolean(left)}
          onClick={() => {
            setRunning("finish");
            void recovery.finish();
          }}
        >
          {running === "finish" ? <Spinner /> : <PasskeyIcon />}
          <span>{running === "finish" ? "Waiting for your new passkey…" : "Finish with your new passkey"}</span>
        </button>
        <ErrorLine error={error} />
        <div className="cp-recovery__actions">
          {back}
          <button
            type="button"
            className="cp-passkey__link"
            data-testid="recovery-forget"
            disabled={busy}
            onClick={recovery.forget}
          >
            Forget it on this device
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="cp-recovery"
      data-testid="recovery-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setRunning("start");
        void recovery.start(code);
      }}
    >
      <h3 className="cp-recovery__title">Recover your account</h3>
      <p className="cp-recovery__text">
        Enter the recovery code you saved, then create a new passkey. The code is used up right away. Your new passkey
        starts working {RECOVERY_DELAY_HOURS} hours later, unless one of the account's existing passkeys cancels it:
        that wait is what keeps a stolen code from taking the account.
      </p>
      <div className="cp-passkey__name">
        <label htmlFor={codeId}>Recovery code</label>
        <input
          id={codeId}
          className="cp-recovery__code"
          data-testid="recovery-code"
          value={code}
          maxLength={80}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-…"
          disabled={busy}
          onChange={(e) => setCode(e.target.value)}
        />
        <span className="cp-recovery__note">Capitals, dashes and spaces don't matter.</span>
      </div>
      <button type="submit" className="cp-passkey__primary" data-testid="recovery-start" disabled={busy || !code.trim()}>
        {running === "start" ? <Spinner /> : <PasskeyIcon />}
        <span>{running === "start" ? "Create your new passkey…" : "Create a new passkey and start"}</span>
      </button>
      <ErrorLine error={error} />
      {back}
    </form>
  );
}

export interface RecoveryAlertProps {
  api: Pick<SessionApi, "busy" | "error" | "recovery">;
  className?: string;
}

/**
 * Signed in: a recovery of this account is under way. Someone holding its
 * recovery code started adding a new passkey; when the delay ends it signs in
 * and every other session, this one included, is signed out. Renders nothing
 * when there is none. Put it where the signed-in app shows account notices.
 */
export function RecoveryAlert({ api, className }: RecoveryAlertProps) {
  const { recovery, busy, error } = api;
  const [cancelling, setCancelling] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!busy) setCancelling(false);
  }, [busy]);

  const pending = recovery.underWay;
  if (!pending) return null;
  const left = timeLeft(pending.readyAt, now);
  const where = recovery.where;

  return (
    <div
      className={className ? `cp-passkey cp-recovery-alert ${className}` : "cp-passkey cp-recovery-alert"}
      role="alert"
      data-testid="recovery-alert"
    >
      <span className="cp-recovery-alert__icon">
        <ShieldIcon />
      </span>
      <div className="cp-recovery-alert__body">
        <strong className="cp-recovery-alert__title">Someone is recovering this account</strong>
        <p className="cp-recovery-alert__text">
          A new passkey was registered with this account's recovery code on {formatWhen(pending.startedAt)}.{" "}
          {left
            ? `It can sign in from ${formatWhen(pending.readyAt)} (in ${left}), and that signs out every other session, this one included.`
            : "It can sign in now, and that signs out every other session, this one included."}{" "}
          If this wasn't you, cancel it with one of your passkeys.
        </p>
        <div className="cp-recovery-alert__actions">
          {where?.kind === "console" ? (
            <a
              className="cp-recovery-alert__button"
              data-testid="recovery-cancel-console"
              href={where.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalIcon />
              <span>Cancel on Calimero Cloud</span>
            </a>
          ) : (
            <button
              type="button"
              className="cp-recovery-alert__button"
              data-testid="recovery-cancel"
              disabled={busy}
              onClick={() => {
                setCancelling(true);
                void recovery.cancel();
              }}
            >
              {cancelling ? <Spinner /> : <PasskeyIcon />}
              <span>{cancelling ? "Waiting for your passkey…" : "Cancel the recovery"}</span>
            </button>
          )}
        </div>
        {error && <p className="cp-recovery-alert__error">{error}</p>}
      </div>
    </div>
  );
}
