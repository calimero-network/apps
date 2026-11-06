import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { inviteLink, inviteToken } from "../instances";

/**
 * Invite a member into the instance's organization. Making an invite is approved
 * with the inviter's passkey (the node answers 412 CONFIRM_REQUIRED and mero-js
 * asks for the passkey); redeeming the link is not.
 */
export function InviteCard({
  client,
  org,
  passkey,
  after,
}: {
  client: CalimeroClient;
  org: string | null;
  passkey: () => PasskeyProvider;
  after: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!org) {
    return (
      <div className="method-card">
        <div className="method-name">2 · Invite a second account</div>
        <p className="method-hint">This instance is private. Create a shared instance to invite others.</p>
      </div>
    );
  }

  async function invite(org: string) {
    setBusy(true);
    setError(null);
    try {
      setLink(inviteLink(await inviteToken(client, org, passkey()), window.location, org));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  return (
    <div className="method-card">
      <div className="method-name">2 · Invite a second account</div>
      <p className="method-hint" style={{ marginBottom: 10 }}>
        A link that makes whoever opens it a member of this instance&apos;s organization. It is single
        use: create another for each account you invite.
      </p>
      <button className="btn-calimero-outline" disabled={busy} onClick={() => void invite(org)}>
        Create an invitation link
      </button>
      {link && (
        <pre aria-label="invitation link" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {link}
        </pre>
      )}
      {error && <pre className="result-box error">{error}</pre>}
    </div>
  );
}
