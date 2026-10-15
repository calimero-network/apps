import { useCallback, useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { publishMemberName, useMemberNames } from "@calimero-apps/names";

import type { ForumClient } from "../generated/ForumClient";
import { getActiveNamespaceId, getUsername, setUsername } from "./session";

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

export function useNickname(client: ForumClient | null, selfAccount?: string | null): Nickname {
  const { admin } = useMero();
  const namespaceId = getActiveNamespaceId();
  const { nameOf } = useMemberNames(admin, namespaceId);
  const [name, setName] = useState(getUsername);

  /**
   * Adopt the name this person already set for the space.
   *
   * A forum nickname is per forum; the space name is per person, shared by
   * every app on the space. Someone who named themselves anywhere on it should
   * not post here as an account id, so a blank local name takes it — and the
   * publish below then puts it on this forum's posts too.
   */
  const spaceName = selfAccount ? nameOf(selfAccount) : undefined;
  useEffect(() => {
    if (getUsername() || !spaceName) return;
    setUsername(spaceName);
    setName(spaceName);
    void client?.setNickname({ name: spaceName }).catch(() => undefined);
  }, [spaceName, client]);
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
      // The space-wide name too, so the rename reaches every forum and every
      // other app on the space. Best-effort: this forum's nickname is the one
      // that was asked for, and a refusal here must not report it as failed.
      if (admin && namespaceId && selfAccount && trimmed) {
        void publishMemberName(admin, namespaceId, selfAccount, trimmed).catch(() => undefined);
      }
      try {
        await client.setNickname({ name: trimmed });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [client, admin, namespaceId, selfAccount],
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

/**
 * The name to byline `account` with: the nickname on this forum, else the name
 * they set for the whole space, else "" (the id fallback in `authorLabel`).
 *
 * The space name answers for authors who never picked a nickname here but did
 * name themselves elsewhere on the space — the common case once a person uses
 * more than one forum or app.
 */
export function useAuthorName(account: string, authorName: string): string {
  const { admin } = useMero();
  const { nameOf } = useMemberNames(admin, getActiveNamespaceId());
  return (authorName ?? "").trim() || nameOf(account) || "";
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
