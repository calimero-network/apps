import {
  CalimeroError,
  NotFound,
  RecoveryNotReady,
  WrongRecoveryCode,
  type AccountRecovery,
} from "@calimero-network/mero-js";
import { describeError, targetKey, type KeyValueStorage, type Target } from "@calimero-apps/connect";

/**
 * Account recovery with a recovery code (core#4844, `docs/specs/account-recovery.md`;
 * mero-js#330). A person who lost every passkey starts a recovery with the
 * code they saved and a new passkey; 72 hours later that passkey finishes it
 * and signs in. Until then any passkey the account still has can cancel it,
 * and every signed-in device sees it (`/auth/me` `recoveryPending`).
 */

export type { AccountRecovery };

/** Core's `RECOVERY_DELAY_SECS`: how long a recovery waits before it may finish. */
export const RECOVERY_DELAY_HOURS = 72;

/** Where the recovery code is made and where the account's passkeys are managed. */
export const CONSOLE_PASSKEYS = "https://cloud.calimero.network/v2/passkeys";

/**
 * Where a recovery can run. Core takes the recovery ceremonies (start,
 * cancel, finish, making a code) only on the cluster's own origins, never on
 * an app's frontend, and a session opened on an app's frontend is bound to
 * that app. So:
 *
 * - `here`: the page is an origin the nodes trust as their own: `merod local`
 *   trusts the dev server (`http://localhost:5173`).
 * - `console`: a Calimero Cloud app, served at `{label}.apps.calimero.network`.
 *   The recovery runs on Calimero Cloud's Passkeys page, and the app links there.
 */
export type RecoveryWhere = { kind: "here" } | { kind: "console"; url: string };

export function recoveryWhere(target: Target): RecoveryWhere {
  return target.kind === "local" ? { kind: "here" } : { kind: "console", url: CONSOLE_PASSKEYS };
}

function isRecovery(value: unknown): value is AccountRecovery {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    typeof v.credentialId === "string" &&
    typeof v.startedAt === "number" &&
    typeof v.readyAt === "number"
  );
}

/**
 * The recovery this browser started on a target, kept because it outlives the
 * tab: the person comes back after the delay to finish it. Per target, not per
 * app: a recovery is the account's. Finishing works without it too (the new
 * passkey names the recovery); it is what shows the time and the button.
 */
export class RecoveryStore {
  readonly key: string;

  constructor(
    target: Target,
    private readonly storage: KeyValueStorage | undefined = globalThis.localStorage,
  ) {
    this.key = `calimero-recovery:${targetKey(target)}`;
  }

  load(): AccountRecovery | null {
    try {
      const raw = this.storage?.getItem(this.key) ?? null;
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isRecovery(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(recovery: AccountRecovery): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(recovery));
    } catch {
      // Storage blocked: the recovery is still under way; finishing works without this copy.
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* nothing stored */
    }
  }
}

/** "Nov 8, 2026, 14:05": a Unix time in seconds, in the person's locale. */
export function formatWhen(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "2 days 23 hours" / "40 minutes" until `readyAt`, or `null` once it passed. */
export function timeLeft(readyAt: number, nowMs: number = Date.now()): string | null {
  const secs = readyAt - Math.floor(nowMs / 1000);
  if (secs <= 0) return null;
  const minutes = Math.ceil(secs / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day");
  if (hours > 0) return mins > 0 ? `${unit(hours, "hour")} ${unit(mins, "minute")}` : unit(hours, "hour");
  return unit(mins, "minute");
}

export type RecoveryStep = "start" | "finish" | "cancel";

/** What went wrong in a recovery step, in words the person can act on. */
export function describeRecoveryError(error: unknown, step: RecoveryStep): string {
  if (error instanceof WrongRecoveryCode) {
    return "That recovery code doesn't match this account's. Check it for typos; a code that was already used or replaced no longer works.";
  }
  if (error instanceof RecoveryNotReady) {
    return error.readyAt
      ? `Not yet: the recovery can finish on ${formatWhen(error.readyAt)}.`
      : `Not yet: the recovery can finish ${RECOVERY_DELAY_HOURS} hours after it started.`;
  }
  if (error instanceof CalimeroError && error.code === "RECOVERY_PENDING") {
    return "A recovery of this account is already under way. Wait for it to finish, or cancel it with one of the account's passkeys.";
  }
  if (error instanceof NotFound || (error instanceof CalimeroError && error.status === 404)) {
    if (step === "start") return "This cluster doesn't offer account recovery yet.";
    return step === "finish"
      ? "There is no recovery under way for this passkey: it was cancelled with one of the account's passkeys, or it already finished."
      : "There is no recovery under way for this account.";
  }
  if (error instanceof CalimeroError && error.code === "BAD_REGISTRATION") {
    return "The new passkey wasn't accepted. Recover your account on Calimero Cloud's Passkeys page.";
  }
  return describeError(error);
}
