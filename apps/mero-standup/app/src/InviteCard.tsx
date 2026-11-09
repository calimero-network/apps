import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, inviteLink } from "@calimero-apps/connect";
import { inviteRoot, inviteToken } from "./teams";

/**
 * Mint a link that makes whoever opens it a member of this team's
 * organization. Making one is approved with the inviter's passkey (the node
 * answers 412 CONFIRM_REQUIRED and mero-js asks for it); redeeming it is not.
 */
export function InviteCard({
  client,
  org,
  passkey,
  after,
}: {
  client: Pick<CalimeroClient, "invite">;
  org: string | null;
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
      setLink(inviteLink(await inviteToken(client, org, passkey()), { org, root: inviteRoot() }));
    } catch (e) {
      setFailed(describeError(e));
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
      // Clipboard access can be denied; the link is on screen and selectable.
      setCopied(false);
    }
  }

  return (
    <div className="card">
      <h2>Invite a teammate</h2>
      {!org ? (
        <p className="empty">This team has no organization, so nobody can be invited to it.</p>
      ) : (
        <>
          <p className="empty" style={{ marginBottom: 14 }}>
            One link, for one person: it is single use, so create another for each teammate. Whoever opens
            it signs in with a passkey, joins this team&apos;s organization and sees its standups and
            decisions; nobody without one can. Creating it asks for your passkey.
          </p>
          <div className="row">
            <button onClick={() => void mint(org)} disabled={busy}>
              {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
            </button>
            {link && (
              <button className="ghost" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {link && (
            <code className="invite-link mono" title={link} aria-label="invitation link">
              {link}
            </code>
          )}
        </>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
