import { useState } from "react";
import type { PasskeyProvider } from "@calimero-network/mero-js";

import { messageOf } from "./chess";
import type { OpenTable } from "./TablePage";
import { inviteToken, tableInviteLink } from "./tables";
import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * Mint a shareable invitation to this table.
 *
 * A table lives in an organization (v1: a namespace), and the invitation
 * makes whoever opens the link a member of it, so they reach this table and
 * every other one in the same organization. Making it is approved with the
 * inviter's passkey (the node answers 412 CONFIRM_REQUIRED and mero-js asks for
 * the passkey); redeeming it is not. The link also names this table, which
 * opens once the invitation is redeemed.
 */
export function InviteCard({
  client,
  table,
  passkey,
  after,
  from,
}: {
  client: ClientRoutes<{ orgs: "inviteCreate" }>;
  table: OpenTable;
  /** The inviter as the invitee is told: "Join {from}'s game as ...?". */
  from?: string | null;
  passkey: () => PasskeyProvider;
  after: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function mint(org: string) {
    setBusy(true);
    setFailed(null);
    setCopied(false);
    try {
      setLink(tableInviteLink(await inviteToken(client, org, passkey()), table.appId, org, from));
    } catch (e) {
      setFailed(messageOf(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the link is on screen and selectable,
      // so this is a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  const org = table.org;

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h2>Invite an opponent</h2>
      </div>
      {!org ? (
        <p className="hint">
          This table belongs to your account alone, so nobody else can reach it. Start a new table
          from the lobby to invite someone.
        </p>
      ) : (
        <>
          <p className="hint">
            One link. Whoever opens it joins this table&apos;s organization, and can take the free
            seat or watch. Single use: one person can join with this link, so generate another for each person you invite.
          </p>

          {link && (
            <div className="link-row">
              {/*
                ONE LINE, truncated, with Copy as the real affordance: nobody
                transcribes an invite link by eye. CSS truncation is visual only,
                so the line still selects and copies in full.
              */}
              <code className="invite-link mono" title={link} aria-label="invitation link">
                {link}
              </code>
              <button className="small" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          <div className="row">
            <button className={link ? "ghost small" : ""} onClick={() => void mint(org)} disabled={busy}>
              {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
            </button>
          </div>

          {link && (
            <p className="hint">
              Send it to whoever you are inviting; they open it, sign in with a passkey, and land in
              this table.
            </p>
          )}
        </>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
