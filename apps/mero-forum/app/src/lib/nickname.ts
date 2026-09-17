import { useCallback, useEffect, useState } from "react";

import type { ForumClient } from "../generated/ForumClient";
import { getUsername, setUsername } from "./session";

/**
 * The name you post under.
 *
 * ── Why this is in TWO places, deliberately ──────────────────────────────────
 *
 * `localStorage` is the source for the INPUT: it survives a reload, so the
 * field is pre-filled and "you are posting as Ana" is true the instant the page
 * renders, before any contract round trip.
 *
 * The contract is the source for DISPLAY. A name kept only in the browser is a
 * name only its owner can see — every other reader still gets a 64-hex account
 * id, which is the thing the name was supposed to replace. So the value is
 * published to `set_nickname`, and `PostView.author_name` / `CommentView
 * .author_name` carry it back to everyone.
 *
 * Keeping both in step is the whole job of this module: the local copy is
 * written first (so the UI never lags the thing you just typed), then pushed.
 * A push that fails leaves the local name intact and reports the error — the
 * alternative, rolling the local value back, throws away what the person typed
 * because of a transient node problem.
 */

export interface Nickname {
  /** What to show as "you", "" when never set. */
  name: string;
  /** True while a rename is being published. */
  saving: boolean;
  /** The last publish failure, or null. The local name is still set. */
  error: string | null;
  /** Set it locally and publish it. Empty string clears the claim. */
  rename: (next: string) => Promise<void>;
}

export function useNickname(client: ForumClient | null): Nickname {
  const [name, setName] = useState(getUsername);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Publish a local name that the contract has not seen.
   *
   * This runs when a client first becomes available, which covers the case the
   * local-only design cannot: you named yourself, then joined a second forum.
   * That forum's contract is a different context with its own profile map and
   * has never heard of you, so without this your posts there would be bylined
   * with an account id while your own header said otherwise.
   */
  useEffect(() => {
    const local = getUsername();
    if (!client || !local) return;
    // Unconditional rather than read-then-compare: `set_nickname` is idempotent
    // and one write is cheaper than a read plus a conditional write. Failure is
    // swallowed on purpose — this is a background reconciliation, and an error
    // toast for something the person did not just do is noise.
    void client.setNickname({ name: local }).catch(() => undefined);
  }, [client]);

  const rename = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      // Local first: the header and the composer label update immediately, and
      // stay updated even if the node is unreachable right now.
      setUsername(trimmed);
      setName(trimmed);
      if (!client) return;
      setSaving(true);
      setError(null);
      try {
        await client.setNickname({ name: trimmed });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [client],
  );

  return { name, saving, error, rename };
}

/**
 * What to print for an author.
 *
 * A blank name is a real state — someone can post before naming themselves — so
 * it falls back to a short account id rather than rendering an empty byline.
 * The fallback is FLAGGED rather than silently substituted, so the UI can style
 * it as the placeholder it is instead of passing an id off as a name.
 */
export interface AuthorLabel {
  label: string;
  /** True when `label` is an id fallback, not a chosen name. */
  anonymous: boolean;
  isSelf: boolean;
}

export function authorLabel(
  account: string,
  authorName: string,
  selfAccount: string | null,
): AuthorLabel {
  const name = (authorName ?? "").trim();
  return {
    label: name || shortAccount(account),
    anonymous: name.length === 0,
    isSelf: !!selfAccount && account === selfAccount,
  };
}

/** An account id is 64 hex characters; show enough to tell people apart. */
export function shortAccount(account: string): string {
  return account.length > 10
    ? `${account.slice(0, 6)}…${account.slice(-4)}`
    : account;
}
