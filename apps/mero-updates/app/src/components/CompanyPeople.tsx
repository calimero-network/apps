import { useState } from "react";

import { PRODUCT_NAME } from "../lib/companies";

/** One person who has Mero Updates in the company. */
export interface CompanyPerson {
  account: string;
  /** The org role: `owner` | `admin` | `member` | `guest`. */
  role: string;
  /** The name they set for the company, `""` when none. */
  name: string;
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", guest: "Guest" };

const short = (account: string) => (account.length > 12 ? `${account.slice(0, 12)}…` : account);

/**
 * Who has Mero Updates in the company, and for its owners and admins, taking
 * someone out of it. Remove asks first; it is never offered on your own row
 * nor on the owner's. In an org that keeps its apps apart (`appOnly`) it is
 * Mero Updates only, and the prompt says the organization stays theirs.
 */
export default function CompanyPeople({
  people,
  me,
  canRemove,
  appOnly,
  busy,
  onRemove,
}: {
  people: CompanyPerson[];
  me: string;
  canRemove: boolean;
  appOnly: boolean;
  /** The account a removal is running for. */
  busy: string | null;
  onRemove: (person: CompanyPerson) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const display = (p: CompanyPerson) => p.name || short(p.account);

  return (
    <div className="peopleList" data-testid="company-people">
      {people.map((p) => {
        const isMe = p.account === me;
        const removable = canRemove && !isMe && p.role !== "owner";
        return (
          <div className="person" key={p.account} data-testid="company-person" data-account={p.account}>
            <div className="personMain">
              <div className="personName" title={p.account}>
                <strong>{display(p)}</strong>
                {isMe && <span className="youTag"> (you)</span>}
                {ROLE_LABEL[p.role] && <span className="teamTag">{ROLE_LABEL[p.role]}</span>}
              </div>
              {removable && confirming === p.account && (
                <p className="muted small" role="alertdialog" aria-label={`Remove ${display(p)}`}>
                  {appOnly
                    ? `Remove ${display(p)} from ${PRODUCT_NAME}? They stay in the organization and its other apps.`
                    : `Remove ${display(p)} from this company? They lose every audience in it.`}
                </p>
              )}
            </div>
            {removable &&
              (confirming === p.account ? (
                <>
                  <button type="button" className="secondary small" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger small"
                    data-testid="confirm-remove-person"
                    onClick={() => {
                      setConfirming(null);
                      onRemove(p);
                    }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setConfirming(p.account)}
                  disabled={busy === p.account}
                  aria-label={`Remove ${display(p)}`}
                  data-testid="remove-person"
                >
                  {busy === p.account ? "Removing…" : "Remove"}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
