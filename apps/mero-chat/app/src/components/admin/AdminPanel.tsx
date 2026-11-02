import { useState } from "react";
import styled from "styled-components";
import { describeError } from "@calimero-apps/connect";

import { selfAccount } from "../../calimero/connection";
import { useWorkspace } from "../../calimero/WorkspaceProvider";
import { shortAccount } from "../../utils/accountIdentity";
import BaseModal from "../common/popups/BaseModal";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: min(520px, 90vw);
  max-height: 70vh;
  overflow-y: auto;
  color: var(--glass-ink);

  h3 {
    margin: 0;
    font-size: 15px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(127, 127, 127, 0.15);
  }
  .muted {
    opacity: 0.65;
    font-size: 12px;
  }
  select,
  button {
    font: inherit;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid rgba(127, 127, 127, 0.35);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .err {
    color: var(--glass-bad-ink);
    font-size: 13px;
  }
`;

const ROLES = ["guest", "member", "admin"] as const;

/**
 * The workspace's members and channels. Everyone sees who is in it; its owner
 * and admins change roles, remove members and delete channels. Each of those
 * is approved with the admin's passkey (the node asks: `412 CONFIRM_REQUIRED`).
 * v1's Details tab (namespace visibility, default capabilities) and Upgrade
 * tab have no counterpart: an org has no visibility mode, and upgrades are the
 * org owner's, in the cloud console.
 */
export default function AdminPanel({
  isOpen,
  setIsOpen,
  toggle,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggle: React.ReactNode;
}) {
  const ws = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = ws.role === "owner" || ws.role === "admin";
  const me = selfAccount();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <Container data-testid="admin-panel">
      <h3>{isAdmin ? "Workspace Admin" : "Workspace members"} · {ws.name}</h3>
      <div>
        <h3>Members ({ws.members.length})</h3>
        {ws.members.map((m) => (
          <div className="row" key={m.account}>
            <span>
              {m.name || shortAccount(m.account)}
              {m.account === me && " (you)"}
              <div className="muted">{m.account}</div>
            </span>
            {isAdmin && m.role !== "owner" && m.account !== me ? (
              <span style={{ display: "flex", gap: 6 }}>
                <select
                  aria-label={`role of ${m.name || m.account}`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void run(() => ws.setMemberRole(m.account, e.target.value as (typeof ROLES)[number]))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => void run(() => ws.removeMember(m.account))}>
                  Remove
                </button>
              </span>
            ) : (
              <span className="muted">{m.role}</span>
            )}
          </div>
        ))}
      </div>
      <div>
        <h3>Channels</h3>
        {ws.conversations
          .filter((c) => c.kind !== "dm")
          .map((c) => (
            <div className="row" key={c.appId}>
              <span>
                {c.kind === "private" ? "🔒 " : "# "}
                {c.name}
              </span>
              {(isAdmin || c.owner === me) && c.name !== "general" && (
                <button disabled={busy} onClick={() => void run(() => ws.deleteConversation(c.appId))}>
                  Delete
                </button>
              )}
            </div>
          ))}
      </div>
      {error && <div className="err">{error}</div>}
    </Container>
  );

  return <BaseModal content={content} open={isOpen} onOpenChange={setIsOpen} toggle={toggle} />;
}
