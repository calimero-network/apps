import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { inviteLink, inviteToken } from "./groups";
import { errText } from "./useMeroVote";
import { CheckIcon, CopyIcon, LinkIcon, UserPlusIcon } from "./icons";
import { IconTile } from "./ui";

/**
 * Mint a link that makes whoever opens it a member of this group's
 * organization (v1: a namespace invitation). Making one is approved with the
 * inviter's passkey (the node answers 412 CONFIRM_REQUIRED and mero-js asks
 * for it); redeeming it is not.
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
      setLink(inviteLink(await inviteToken(client, org, passkey()), window.location, org));
    } catch (e) {
      setFailed(errText(e));
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
      <div className="card-head">
        <IconTile accent>
          <UserPlusIcon size={18} />
        </IconTile>
        <div className="grow">
          <h2>Invite someone</h2>
          <div className="meta">Members can vote and audit every tally</div>
        </div>
      </div>
      {!org ? (
        <p className="hint">This group has no organization, so nobody can be invited to it.</p>
      ) : (
        <>
          <p className="hint">
            One link, for one person: it is single use, so create another for each member. Whoever opens it
            signs in with a passkey, joins this group&apos;s organization and sees its polls. Creating it asks
            for your passkey.
          </p>
          <button className={link ? "ghost" : ""} onClick={() => void mint(org)} disabled={busy} style={{ width: "100%" }}>
            <LinkIcon size={16} />
            {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
          </button>
          {link && (
            <div className="link-field">
              <code className="invite-link mono" title={link} aria-label="invitation link">
                {link}
              </code>
              <button className="sm" onClick={() => void copy()}>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
