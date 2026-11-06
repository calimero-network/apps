import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";

import { inviteLink, inviteToken } from "./arenas";
import type { OpenArena } from "./ArenaPage";
import { messageOf } from "./kombat";

/**
 * Mint a shareable invitation to this arena.
 *
 * An arena lives in an organization (v1: a namespace), and the invitation
 * makes whoever opens the link a member of it, so they reach this arena and
 * every other one in the same organization. Making it is approved with the
 * inviter's passkey (the node answers 412 CONFIRM_REQUIRED and mero-js asks for
 * the passkey); redeeming it is not. The link also names this arena, which
 * opens once the invitation is redeemed.
 */
export function InviteCard({
  client,
  arena,
  passkey,
  after,
}: {
  client: Pick<CalimeroClient, "invite">;
  arena: OpenArena;
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
      setLink(inviteLink(await inviteToken(client, org, passkey()), arena.appId, window.location, org));
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

  const org = arena.org;

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h2>Invite an opponent</h2>
      </div>
      {!org ? (
        <p className="hint">
          This arena belongs to your account alone, so nobody else can reach it. Start a new arena
          from the lobby to invite someone.
        </p>
      ) : (
        <>
          <p className="hint">
            One link, for one person: it is single use, so create another for each opponent. Whoever
            opens it joins this arena&apos;s organization, and can take the open corner or watch.
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
              this arena.
            </p>
          )}
        </>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
