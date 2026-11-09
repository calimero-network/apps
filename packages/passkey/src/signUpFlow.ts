import type { PasskeyProvider } from "@calimero-network/mero-js";

/**
 * Where a sign-up is: `create` while the browser makes the new passkey,
 * `approve` while it waits for the person to click "Approve with your new
 * passkey", `confirm` while that second prompt is open.
 */
export type SignUpStage = "create" | "approve" | "confirm";

/** The person cancelled a sign-up at its Approve step, or left the page. A quiet cancel. */
export class SignUpCancelled extends Error {
  constructor() {
    super("The sign-up was cancelled before its account was created.");
    this.name = "SignUpCancelled";
  }
}

export interface SignUpFlowTiming {
  /** A refusal that came back sooner than this showed no prompt, so it is asked again once. */
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
 * that one creates the account and redeems an invite. mero-js asked for the
 * second the moment the first returned. A password manager extension
 * (Bitwarden, 1Password) is still saving the new passkey then, and refuses it
 * ("A request is already pending", or "The document is not focused" while
 * its popup has focus): a passkey and no account, on every try.
 *
 * So the second prompt waits at `approve` for its own click (`approve()`). A
 * refusal that came back at once (the browser or extension showed nothing)
 * is asked again once; any other failure is kept in `confirmFailure` and the
 * flow waits at `approve` again, so the sign-up is never lost to it. The
 * node's 5-minute challenge window covers the pause.
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
  /** Give up at the Approve step (or on leaving the page): the sign-up rejects with {@link SignUpCancelled}. */
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
    create: async (options) => {
      if (cancelled) throw new SignUpCancelled();
      update({ stage: "create" });
      const registration = await passkey.create(options);
      created = true;
      return registration;
    },
    // `options` carries mero-js's `userVerification: 'required'` on a confirm
    // prompt (mero-js#338): the node refuses an approval without it.
    get: async (challenge, rpId, allowCredentials, options) => {
      // Not after a create (nothing to approve): straight through.
      if (!created) return passkey.get(challenge, rpId, allowCredentials, options);
      for (;;) {
        if (cancelled) throw new SignUpCancelled();
        update({ stage: "approve" });
        await new Promise<void>((resolve, reject) => {
          waiting = { resolve, reject };
        });
        update({ stage: "confirm", confirmFailure: null });
        try {
          return await askOnce(() => passkey.get(challenge, rpId, allowCredentials, options));
        } catch (e) {
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
      const w = waiting;
      waiting = null;
      w?.reject(new SignUpCancelled());
    },
  };
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

/** A sign-up whose passkey was made but which ended without an account (nothing left to approve). */
export const SIGN_UP_ENDED_WITHOUT_ACCOUNT =
  "Your passkey was made, but your account wasn't created. Create a passkey again to sign up.";

/**
 * A failed second prompt of a sign-up, in words. `ended`: the sign-up is
 * over, so there is no Approve button to press any more.
 */
export function describeSignUpNotFinished(error: unknown, ended = false): string {
  const head = ended ? SIGN_UP_ENDED_WITHOUT_ACCOUNT : SIGN_UP_NOT_FINISHED;
  return isPromptStuck(error) ? `${head} ${PROMPT_STUCK_ADVICE}` : head;
}
