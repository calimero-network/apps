import type { MemberView, UpdateView } from "../generated/StandupClient";

/** A 64-hex account id, shortened for a byline: `a1b2c3…7890`. */
export function shortAccount(account: string): string {
  return account.length > 12 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}

/**
 * What to call someone. Their chosen name if they set one, else a short id —
 * never a blank byline, because posting before naming yourself is normal.
 */
export function displayName(account: string, name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : shortAccount(account);
}

/**
 * Who has taken part but has not posted among `posted`.
 *
 * Only members the contract knows about — anyone who ever posted or named
 * themselves. A teammate who joined and never opened the app is invisible to
 * it, so the UI words this as "not posted yet", never "everyone is done". It
 * is shown for today only: for a past day the contract cannot tell "skipped
 * it" from "had not joined yet".
 */
export function notYetPosted(members: MemberView[], posted: UpdateView[]): MemberView[] {
  const done = new Set(posted.map((u) => u.author));
  return members
    .filter((m) => !done.has(m.account))
    .sort((a, b) => displayName(a.account, a.name).localeCompare(displayName(b.account, b.name)));
}
