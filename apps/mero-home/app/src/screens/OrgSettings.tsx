import { useState } from "react";
import { passkeyConfirm, type PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, type ClientRoutes } from "@calimero-apps/connect";

import {
  displayName,
  isAdmin,
  orgName,
  roleLabel,
  setOrgProfile,
  transferCandidates,
  typedMatches,
  type OrgView,
  type Person,
} from "../home";
import { readLogo as defaultReadLogo } from "../logo";

export interface OrgSettingsProps {
  client: ClientRoutes<{ orgs: "metadata" | "setMember" | "delete" }>;
  view: OrgView;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a change the node accepted: the org is read again. */
  onChanged: () => void;
  /** After the organization was deleted: Home goes back to the org picker. */
  onDeleted: () => void;
  /** Reads a chosen image as a logo `data:` URL (tests replace it). */
  readLogo?: (file: File) => Promise<string>;
}

/**
 * The Organization screen (owners and admins). Admins set the name and logo
 * Home shows (org metadata: core has no rename, so the name it was made with
 * stays its name elsewhere). Only the owner transfers ownership (one owner:
 * they become an admin) or deletes the organization, behind a typed name;
 * each is one passkey step-up. The recovery key and release approvals are
 * the console's, not Home's.
 */
export function OrgSettings({
  client,
  view,
  account,
  passkey,
  after,
  onChanged,
  onDeleted,
  readLogo = defaultReadLogo,
}: OrgSettingsProps) {
  const owner = view.role === "owner";
  const [name, setName] = useState(view.profile.name ?? "");
  const [logo, setLogo] = useState<string | null>(view.profile.logo);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const candidates = transferCandidates(view, account);
  const [heir, setHeir] = useState<string>("");
  const [transferring, setTransferring] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");

  if (!isAdmin(view.role)) return null;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
      after();
    }
  }

  const changed = (name.trim() || null) !== view.profile.name || logo !== view.profile.logo;

  const save = () =>
    run("profile", async () => {
      await setOrgProfile(client, view.org, view.metadata, { name: name.trim() || null, logo });
      setNotice("Saved.");
      onChanged();
    });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setLogo(await readLogo(file));
    } catch (e) {
      setError(describeError(e));
    }
  };

  const transfer = (p: Person) =>
    run("transfer", async () => {
      await client.orgs.setMember(
        { org: view.org, account: p.account, role: "owner" },
        { confirm: passkeyConfirm(passkey()) },
      );
      setTransferring(null);
      setNotice(`${displayName(p)} owns ${orgName(view)} now. You are an admin.`);
      onChanged();
    });

  const remove = () =>
    run("delete", async () => {
      await client.orgs.delete({ org: view.org }, { confirm: passkeyConfirm(passkey()) });
      setDeleting(false);
      onDeleted();
    });

  const shown = orgName(view);

  return (
    <section className="home-card" aria-label="Organization settings">
      <h2>Name and logo</h2>
      <form
        className="home-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="home-field">
          <span>Name shown in Home</span>
          <input
            value={name}
            maxLength={64}
            placeholder={view.name}
            onChange={(e) => setName(e.target.value)}
            data-testid="org-name"
          />
        </label>
        <p className="home-muted">
          Empty shows the name it was made with, &ldquo;{view.name}&rdquo;, which stays its name in other apps and
          invitations: this cluster cannot rename an organization.
        </p>
        <div className="home-row">
          {logo ? (
            <img src={logo} alt={`${shown} logo`} className="home-logo" data-testid="org-logo-preview" />
          ) : (
            <span className="home-muted">No logo</span>
          )}
          <label className="glass-btn home-filebtn">
            Choose an image…
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="home-file"
              onChange={(e) => void pick(e.target.files?.[0])}
              data-testid="org-logo-file"
            />
          </label>
          {logo && (
            <button type="button" className="glass-btn" onClick={() => setLogo(null)} data-testid="org-logo-clear">
              Remove logo
            </button>
          )}
        </div>
        <button
          type="submit"
          className="glass-btn glass-btn--primary"
          disabled={!changed || busy !== null}
          data-testid="org-profile-save"
        >
          {busy === "profile" ? "Saving…" : "Save"}
        </button>
      </form>

      {owner && (
        <>
          <h2>Transfer ownership</h2>
          {candidates.length === 0 ? (
            <p className="home-muted" data-testid="no-heir">
              There is nobody else here to hand it to (a guest cannot own it).
            </p>
          ) : (
            <div className="home-row">
              <label className="home-field">
                <span>New owner</span>
                <select value={heir} onChange={(e) => setHeir(e.target.value)} data-testid="transfer-to">
                  <option value="">Choose…</option>
                  {candidates.map((p) => (
                    <option key={p.account} value={p.account}>
                      {displayName(p)} ({roleLabel(p.role)})
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="glass-btn"
                disabled={!heir || busy !== null}
                onClick={() => setTransferring(candidates.find((p) => p.account === heir) ?? null)}
                data-testid="transfer"
              >
                Transfer…
              </button>
            </div>
          )}
          {transferring && (
            <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="transfer-title" data-testid="transfer-confirm">
              <h3 id="transfer-title">
                Make {displayName(transferring)} the owner of {shown}?
              </h3>
              <p>
                An organization has one owner. You become an admin; only {displayName(transferring)} can then transfer
                it again or delete it. Your passkey is asked once.
              </p>
              <div className="home-row">
                <button
                  className="glass-btn glass-btn--primary"
                  disabled={busy !== null}
                  onClick={() => void transfer(transferring)}
                  data-testid="transfer-confirm-yes"
                >
                  {busy === "transfer" ? "Transferring…" : "Transfer ownership"}
                </button>
                <button className="glass-btn" disabled={busy !== null} onClick={() => setTransferring(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <h2>Delete the organization</h2>
          {!deleting ? (
            <button
              className="glass-btn home-danger"
              disabled={busy !== null}
              onClick={() => {
                setTyped("");
                setDeleting(true);
              }}
              data-testid="delete-org"
            >
              Delete {shown}…
            </button>
          ) : (
            <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="delete-org-title" data-testid="delete-org-confirm">
              <h3 id="delete-org-title">Delete {shown}?</h3>
              <p>
                This deletes <strong>every app in it, with all their data</strong>
                {view.apps.length > 0 ? ` (${view.apps.map((a) => a.name).join(", ")})` : ""}, every invitation, and
                everyone&apos;s place in it. It cannot be undone. Your passkey is asked once.
              </p>
              <label className="home-field">
                <span>Type {shown} to confirm</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-org-typed" />
              </label>
              <div className="home-row">
                <button
                  className="glass-btn glass-btn--primary home-danger"
                  disabled={!typedMatches(typed, shown) || busy !== null}
                  onClick={() => void remove()}
                  data-testid="delete-org-yes"
                >
                  {busy === "delete" ? "Deleting…" : "Delete the organization"}
                </button>
                <button className="glass-btn" disabled={busy !== null} onClick={() => setDeleting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <p className="home-muted">The recovery key and release approvals are in the Calimero console.</p>
      {notice && (
        <p className="home-notice" role="status" data-testid="settings-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="home-error" role="alert" data-testid="settings-error">
          {error}
        </p>
      )}
    </section>
  );
}
