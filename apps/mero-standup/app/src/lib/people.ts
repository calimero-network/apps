import type { MemberView, UpdateView } from "../generated/StandupClient";

/** A 64-hex account id, shortened for a byline: `a1b2c3…7890`. */
export function shortAccount(account: string): string {
  return account.length > 12 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}

/**
 * What to call someone. Their chosen name on this team if they set one, else
 * the name they set for the whole namespace (`spaceName`, shared by every app
 * on it), else a short id — never a blank byline, because posting before
 * naming yourself is normal.
 */
export function displayName(
  account: string,
  name: string | null | undefined,
  spaceName?: string | null,
): string {
  return name?.trim() || spaceName?.trim() || shortAccount(account);
}

/** Up to two letters for an avatar: "Ana Lee" -> "AL", unnamed -> from the id. */
export function initials(
  account: string,
  name: string | null | undefined,
  spaceName?: string | null,
): string {
  const words = (name?.trim() || spaceName || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return account.slice(0, 2).toUpperCase();
}

/**
 * A hue for someone's avatar, from their ACCOUNT, not their name: renaming
 * yourself must not change your colour, and two people who pick the same name
 * still look different.
 */
export function avatarHue(account: string): number {
  let h = 0;
  for (let i = 0; i < account.length; i++) h = (h * 31 + account.charCodeAt(i)) >>> 0;
  return h % 360;
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
