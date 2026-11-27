import { useState } from "react";
import { clusterName } from "@calimero-apps/connect";
import { NodeShield } from "@calimero-apps/passkey";

import { roleName } from "./lib/manage";
import { PersonName, useOrg, useSpaceNames } from "./names";
import { useSessionApi, useSignedIn } from "./sessionContext";
import { Avatar, Icon } from "./ui";

/** Where this session's node is, in words. */
function whereSignedIn(session: ReturnType<typeof useSessionApi>["api"]["session"]): { label: string; detail: string } {
  if (session.status !== "signed-in") return { label: "Not signed in", detail: "" };
  const t = session.target;
  if (t.kind === "local") return { label: "Local node", detail: t.nodes[0] ?? "" };
  const cluster = clusterName(t);
  return { label: "Calimero Cloud", detail: cluster ?? t.cluster };
}

/** You: your name, account, how and where you signed in, your role here, and the node's security details. */
export function ProfilePage({
  workspaceName,
  onSwitchWorkspace,
  onLogout,
}: {
  /** `null` when no workspace is open. */
  workspaceName: string | null;
  onSwitchWorkspace?: () => void;
  onLogout: () => void;
}) {
  const { accountId } = useSignedIn();
  const { api } = useSessionApi();
  const { org, members } = useOrg();
  const { nameOf, publish } = useSpaceNames();
  const [editing, setEditing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const where = whereSignedIn(api.session);
  const name = nameOf(accountId);

  return (
    <div className="profile-page">
      <header className="page-head">
        <div>
          <h1>Profile</h1>
          <p className="dim">Your account, and how you are signed in.</p>
        </div>
      </header>

      <section className="card profile-card">
        <Avatar account={accountId} size={64} />
        <div className="profile-who">
          {editing === null ? (
            <>
              <h2 className="profile-name">
                <PersonName account={accountId} />
              </h2>
              {org && (
                <button type="button" className="btn small ghost" onClick={() => setEditing(name ?? "")}>
                  <Icon name="pen" /> {name ? "Change name" : "Set your name"}
                </button>
              )}
            </>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                publish(accountId, editing);
                setEditing(null);
              }}
            >
              <input aria-label="your name" autoFocus maxLength={64} value={editing} onChange={(e) => setEditing(e.target.value)} />
              <button type="submit" className="btn small primary" disabled={!editing.trim()}>
                Save
              </button>
              <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </form>
          )}
          <p className="dim small">Your teammates see this name on transcripts and action items.</p>
        </div>
      </section>

      <section className="card">
        <h2>Account</h2>
        <dl className="facts">
          <div>
            <dt>Signed in with</dt>
            <dd>
              <Icon name="key" /> Passkey
            </dd>
          </div>
          <div>
            <dt>Signed in to</dt>
            <dd>
              {where.label}
              {where.detail && <span className="mono dim"> · {where.detail}</span>}
            </dd>
          </div>
          <div>
            <dt>Account ID</dt>
            <dd className="fact-id">
              <span className="mono wrap-anywhere">{accountId}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Copy account ID"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(accountId)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => undefined);
                }}
              >
                <Icon name={copied ? "check" : "copy"} />
              </button>
            </dd>
          </div>
          {workspaceName !== null && (
          <div>
            <dt>Workspace</dt>
            <dd>
              {workspaceName || "Unnamed workspace"}
              {members && <span className="role-badge">{roleName(members.roles.get(accountId))}</span>}
            </dd>
          </div>
          )}
        </dl>
        <div className="row profile-actions">
          {onSwitchWorkspace && (
            <button type="button" className="btn" onClick={onSwitchWorkspace}>
              Switch workspace
            </button>
          )}
          <button type="button" className="btn danger-ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </section>

      <details className="card advanced-details">
        <summary>
          <span>Node security</span>
          <span className="dim">For checking which node keeps your data and whether it is sealed.</span>
        </summary>
        <div className="shield-slot">
          <NodeShield />
        </div>
      </details>
    </div>
  );
}
