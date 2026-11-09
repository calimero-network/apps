import type { PasskeyProvider } from "@calimero-network/mero-js";

/**
 * Where a sign-up is: `create` while the browser makes the new passkey,
 * `confirm` while the second prompt is open, `approve` while it waits for the
 * person to click "Approve with your new passkey" (after that prompt, asked
 * right away, failed or was refused).
 */
export type SignUpStage = "create" | "approve" | "confirm";

/** Said while a sign-up's second prompt is open: the approval that creates the account. */
export const SIGN_UP_CONFIRMING = "Last step: this approval creates your account.";

/** Said while the second prompt waits for its click (the browser would not show it on its own). */
export const SIGN_UP_READY = "Your passkey is saved. One more tap creates your account.";

/** The person cancelled a sign-up at its Approve step, or left the page. A quiet cancel. */
export class SignUpCancelled extends Error {
  constructor() {
    super("The sign-up was cancelled before its account was created.");
    this.name = "SignUpCancelled";
  }
}

export interface SignUpFlowTiming {
  /**
   * A refusal that came back sooner than this showed no prompt: the first
   * time, the sign-up waits for a click; after a click, it is asked again once.
   */
  instantMs?: number;
  /** How long to wait before asking again. */
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One sign-up's passkey and where it is. Pass `passkey` to `client.signUp`.
 *
 * Since core #4849 a sign-up takes two prompts: one creates the passkey, the
 * second approves the new account with it (`412 CONFIRM_REQUIRED`), and only
 * that one creates the account and redeems an invite.
 *
 * The second prompt is asked right after the first (`confirm`): Chromium
 * shows a WebAuthn prompt after awaited fetches with no new click. Two cases
 * refuse it, and then the flow waits at `approve` for the person's click
 * (`approve()`) instead of losing the sign-up:
 * - Safari has asked for a user gesture before a WebAuthn prompt. Its
 *   refusal is a `NotAllowedError` that comes back at once (under
 *   `instantMs`), with nothing shown.
 * - A blocked prompt: another one, or a password manager's popup, is still
 *   open (mero-js's `ConfirmPromptBlocked`, "A request is already pending",
 *   "The document is not focused"; {@link isPromptStuck}).
 *
 * Any other failure of that first ask (a prompt the person saw and closed,
 * a timeout) also waits at `approve`, with the failure in `confirmFailure`:
 * the passkey exists, so the sign-up is never lost to it and never a quiet
 * cancel. After a click, a refusal that came back at once is asked again
 * once; any other failure is kept in `confirmFailure` and the flow waits at
 * `approve` again. The node's 5-minute challenge window covers the pause.
 *
 * `cancel()` ends the sign-up at any stage. A passkey prompt that is open
 * then (the create, or the second prompt) is closed through the `signal` the
 * flow hands mero-js's provider (mero-js 29.7.7+); the sign-up rejects with
 * {@link SignUpCancelled}.
 */
export interface SignUpFlow {
  readonly passkey: PasskeyProvider;
  readonly stage: SignUpStage | null;
  /** The new passkey exists: from here a failure is no quiet cancel. */
  readonly created: boolean;
  /** `cancel()` ended it. */
  readonly cancelled: boolean;
  /** Why the last approval failed, until the next one starts; `null` when none did. */
  readonly confirmFailure: { error: unknown } | null;
  /** The click that starts the second prompt. Does nothing outside `approve`. */
  approve(): void;
  /** Give up (the Cancel button, or leaving the page): closes an open prompt, and the sign-up rejects with {@link SignUpCancelled}. */
  cancel(): void;
}

/** `passkey` for one sign-up; `onChange` runs whenever stage or error changes. */
export function signUpFlow(passkey: PasskeyProvider, onChange: () => void = () => {}, timing: SignUpFlowTiming = {}): SignUpFlow {
  const {
    instantMs = 1000,
    retryDelayMs = 500,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = timing;

  let stage: SignUpStage | null = null;
  let created = false;
  let cancelled = false;
  let confirmFailure: { error: unknown } | null = null;
  let waiting: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  // Closes whichever prompt is open when cancel() runs.
  const aborter = new AbortController();
  const withAbort = (given?: AbortSignal): AbortSignal => {
    if (!given) return aborter.signal;
    const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    return any ? any([given, aborter.signal]) : aborter.signal;
  };
  /** A prompt's failure, or {@link SignUpCancelled} when cancel() closed it. */
  const unlessCancelled = (e: unknown): unknown => (cancelled ? new SignUpCancelled() : e);

  const update = (next: Partial<{ stage: SignUpStage | null; confirmFailure: { error: unknown } | null }>) => {
    if ("stage" in next) stage = next.stage ?? null;
    if ("confirmFailure" in next) confirmFailure = next.confirmFailure ?? null;
    onChange();
  };

  /** Ask; a refusal within `instantMs` showed nothing, so ask once more. */
  const askOnce = async <T>(ask: () => Promise<T>): Promise<T> => {
    const started = now();
    try {
      return await ask();
    } catch (e) {
      if (now() - started >= instantMs) throw e;
      await sleep(retryDelayMs);
      return ask();
    }
  };

  const wrapped: PasskeyProvider = {
    ...passkey,
    create: async (options, createOptions) => {
      if (cancelled) throw new SignUpCancelled();
      update({ stage: "create" });
      let registration;
      try {
        registration = await passkey.create(options, { ...createOptions, signal: withAbort(createOptions?.signal) });
      } catch (e) {
        throw unlessCancelled(e);
      }
      if (cancelled) throw new SignUpCancelled();
      created = true;
      return registration;
    },
    // `options` carries mero-js's `userVerification: 'required'` on a confirm
    // prompt (mero-js#338): the node refuses an approval without it.
    get: async (challenge, rpId, allowCredentials, options) => {
      // Not after a create (nothing to approve): straight through.
      if (!created) return passkey.get(challenge, rpId, allowCredentials, options);
      if (cancelled) throw new SignUpCancelled();
      const ask = () => passkey.get(challenge, rpId, allowCredentials, { ...options, signal: withAbort(options?.signal) });
      // Right away first; a click only when that did not work.
      update({ stage: "confirm", confirmFailure: null });
      const started = now();
      try {
        return await ask();
      } catch (e) {
        // Never the end of the sign-up: the passkey exists, so it waits at
        // Approve. A prompt the browser would not show is no error to show.
        if (cancelled) throw new SignUpCancelled();
        if (!needsClick(e, now() - started < instantMs)) update({ confirmFailure: { error: e } });
      }
      for (;;) {
        if (cancelled) throw new SignUpCancelled();
        update({ stage: "approve" });
        await new Promise<void>((resolve, reject) => {
          waiting = { resolve, reject };
        });
        update({ stage: "confirm", confirmFailure: null });
        try {
          return await askOnce(ask);
        } catch (e) {
          if (cancelled) throw new SignUpCancelled();
          // Shown, never a quiet cancel: the passkey exists and the account
          // does not. The Approve button stays for another try.
          update({ confirmFailure: { error: e } });
        }
      }
    },
  };

  return {
    passkey: wrapped,
    get stage() {
      return stage;
    },
    get created() {
      return created;
    },
    get cancelled() {
      return cancelled;
    },
    get confirmFailure() {
      return confirmFailure;
    },
    approve() {
      const w = waiting;
      waiting = null;
      w?.resolve();
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      aborter.abort();
      const w = waiting;
      waiting = null;
      w?.reject(new SignUpCancelled());
    },
  };
}

/**
 * A second prompt the browser would not show without a click (Approve with no
 * error shown): blocked
 * ({@link isPromptStuck}), or a `NotAllowedError` that came back at once
 * (`instant`), which is how Safari refuses a WebAuthn call with no user gesture.
 */
function needsClick(error: unknown, instant: boolean): boolean {
  if (isPromptStuck(error)) return true;
  if (!instant) return false;
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    if ((e as { name?: unknown }).name === "NotAllowedError") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * A dismissed or timed-out passkey prompt. The person chose not to go on, so
 * it is a quiet cancel, not an error to show.
 *
 * A prompt the browser or a password manager blocked (mero-js's
 * `ConfirmPromptBlocked`, or "already pending" / "not focused") is not: the
 * person did not choose it, and has to be told what is in the way. Its
 * `cause` is often a `NotAllowedError`, so it is decided before the walk.
 */
export function isPasskeyCancel(error: unknown): boolean {
  if (isPromptStuck(error)) return false;
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const name = (e as { name?: unknown }).name;
    if (name === "NotAllowedError" || name === "AbortError" || name === "ConfirmCancelled" || name === "SignUpCancelled") {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** What a sign-up says when its second prompt failed after the passkey was made. */
export const SIGN_UP_NOT_FINISHED =
  "Your passkey was made, but your account isn't created yet. Approve with it to finish.";

/** A prompt the browser refused because another one, or a password manager's popup, is still open. */
export const PROMPT_STUCK_ADVICE =
  "Your browser or a password manager is still busy with the last passkey prompt. Finish or close it " +
  "(look for a password manager's popup or a window behind this one), then approve again. If it keeps failing " +
  "right after you approve, a password manager extension is handling passkeys on this page: turn off its " +
  "passkey option for this site, or use a private window without extensions.";

/**
 * "A request is already pending", "The document is not focused", or
 * `InvalidStateError`, also when wrapped; and mero-js's `ConfirmPromptBlocked`,
 * which is how its confirm prompts report those.
 */
export function isPromptStuck(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const { name, message } = e as { name?: unknown; message?: unknown };
    if (name === "InvalidStateError" || name === "ConfirmPromptBlocked") return true;
    if (typeof message === "string" && /request is already pending|not focused/i.test(message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** A failed second prompt of a sign-up, in words: it waits at Approve, with what is in the way when a prompt is stuck. */
export function describeSignUpNotFinished(error: unknown): string {
  return isPromptStuck(error) ? `${SIGN_UP_NOT_FINISHED} ${PROMPT_STUCK_ADVICE}` : SIGN_UP_NOT_FINISHED;
}
