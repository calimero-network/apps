import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, inviteLink } from "@calimero-apps/connect";

import { inviteRoot, inviteToken } from "./stores";

/**
 * Invite a member into the store's organization. Making an invite is approved
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
      <div className="card">
        <h2>Invite</h2>
        <p className="empty">This store is private. Create a shared store to invite others.</p>
      </div>
    );
  }

  async function invite(org: string) {
    setBusy(true);
    setError(null);
    try {
      setLink(inviteLink(await inviteToken(client, org, passkey()), { org, root: inviteRoot() }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  return (
    <div className="card">
      <h2>Invite</h2>
      <p className="empty" style={{ marginBottom: 10 }}>
        A link that makes whoever opens it a member of this store&apos;s organization. It is single use:
        create another for each person you invite.
      </p>
      <button className="ghost" disabled={busy} onClick={() => void invite(org)}>
        Create an invitation link
      </button>
      {link && (
        <pre aria-label="invitation link" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {link}
        </pre>
      )}
      {error && <pre className="err">{error}</pre>}
    </div>
  );
}
