import { useState } from "react";

import { PRODUCT_NAME } from "../config";

/** One person who has Mero Forum in the space. */
export interface SpacePerson {
  account: string;
  /** The org role: `owner` | `admin` | `member` | `guest`. */
  role: string;
  /** The name they set for the space, `""` when none. */
  name: string;
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", guest: "Guest" };

const short = (account: string) => (account.length > 12 ? `${account.slice(0, 12)}…` : account);

/**
 * Who has Mero Forum in the space, and for its owners and admins, taking
 * someone out of it. Remove asks first; it is never offered on your own row
 * nor on the owner's. In an org that keeps its apps apart (`appOnly`) it is
 * Mero Forum only, and the prompt says the organization stays theirs.
 */
export default function SpacePeople({
  people,
  me,
  canRemove,
  appOnly,
  busy,
  onRemove,
}: {
  people: SpacePerson[];
  me: string;
  canRemove: boolean;
  appOnly: boolean;
  /** The account a removal is running for. */
  busy: string | null;
  onRemove: (person: SpacePerson) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const display = (p: SpacePerson) => p.name || short(p.account);

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} data-testid="space-people">
      {people.map((p) => {
        const isMe = p.account === me;
        const removable = canRemove && !isMe && p.role !== "owner";
        return (
          <li key={p.account} data-testid="space-person" data-account={p.account}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                className="x-sideText"
                style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={p.account}
              >
                {display(p)}
                {isMe && " (you)"}
                {ROLE_LABEL[p.role] && ` · ${ROLE_LABEL[p.role]}`}
              </span>
              {removable && confirming !== p.account && (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-btn-sm"
                  onClick={() => setConfirming(p.account)}
                  disabled={busy === p.account}
                  aria-label={`Remove ${display(p)}`}
                  data-testid="remove-person"
                >
                  {busy === p.account ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
            {removable && confirming === p.account && (
              <div role="alertdialog" aria-label={`Remove ${display(p)}`} style={{ marginTop: 6 }}>
                <p className="x-sideText" style={{ margin: "0 0 6px" }}>
                  {appOnly
                    ? `Remove ${display(p)} from ${PRODUCT_NAME}? They stay in the organization and its other apps.`
                    : `Remove ${display(p)} from this space? They lose every forum in it.`}
                </p>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-dangerSolid ui-btn-sm"
                    data-testid="confirm-remove-person"
                    onClick={() => {
                      setConfirming(null);
                      onRemove(p);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
