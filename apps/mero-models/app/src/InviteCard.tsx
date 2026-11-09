import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, inviteLink } from "@calimero-apps/connect";
import { inviteRoot, inviteToken } from "./scenes";

/**
 * Mint a shareable invitation to this scene's studio (its organization; v1: a
 * namespace invitation). Making one is approved with the inviter's passkey
 * (the node answers 412 CONFIRM_REQUIRED and mero-js asks for it); redeeming
 * it is not. One link, HTTPS: whoever opens it signs in with a passkey and
 * joins the organization, which reaches every scene in it.
 */
export function InviteCard({
  client,
  org,
  passkey,
  after = () => {},
}: {
  client: Pick<CalimeroClient, "invite">;
  org: string | null;
  passkey: () => PasskeyProvider;
  after?: () => void;
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
      // Clipboard access can be denied; the link is on screen and selectable,
      // so this is a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h3>Invite someone</h3>
      </div>
      {!org ? (
        <p className="hint">This scene has no organization, so nobody can be invited to it.</p>
      ) : (
        <p className="hint">
          One link, for one person: it is single use, so create another for each member. Whoever opens it signs
          in with a passkey and joins this scene&apos;s studio, so this scene and every other scene in it open for
          them. Creating it asks for your passkey.
        </p>
      )}

      {link && (
        /*
          One line, truncated, with Copy as the real affordance: nobody
          transcribes an invite link by eye. `title` holds the full value and
          the Copy button writes `link`, not what is painted.
        */
        <div className="link-row">
          <code className="invite-link mono" title={link} aria-label="invitation link">
            {link}
          </code>
          <button className="small" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {org && (
        <div className="row">
          <button className={link ? "ghost small" : ""} onClick={() => void mint(org)} disabled={busy}>
            {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
          </button>
        </div>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
