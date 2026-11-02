import { useCallback, useEffect, useState } from "react";
import { CalimeroError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { connection } from "../calimero/connection";
import {
  createWorkspace,
  dropInvite,
  listWorkspaces,
  pendingInvite,
  type Workspace,
} from "../calimero/workspace";
import { getMessengerDisplayName, setMessengerDisplayName } from "../utils/messengerName";
import { Card, Center } from "./SignIn";

/**
 * Choose a workspace (an organization), create one, or join one by the
 * invitation link that opened the app. v1's NamespaceEntryPopup, on orgs.
 */
export default function Workspaces({
  onOpen,
  onSignOut,
}: {
  onOpen: (org: string) => void;
  onSignOut: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState(getMessengerDisplayName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const conn = connection();
    try {
      const [list, me] = await Promise.all([listWorkspaces(conn.client), conn.client.me()]);
      setWorkspaces(list);
      if (!getMessengerDisplayName() && typeof me.name === "string") {
        setUsername((u) => u || String(me.name));
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      conn.after();
    }
  }, []);

  // An invitation link opened before signing in is redeemed once a session exists.
  useEffect(() => {
    const token = pendingInvite();
    if (!token) {
      void refresh();
      return;
    }
    const conn = connection();
    void (async () => {
      try {
        const res = await conn.client.redeemInvite(token);
        dropInvite();
        const org = typeof res.org === "string" ? res.org : typeof res.orgId === "string" ? res.orgId : null;
        setNotice("Invitation accepted.");
        if (org) {
          const display = getMessengerDisplayName() || String((await conn.client.me()).name ?? "");
          if (display) await conn.client.setMemberMetadata(org, conn.accountId, { name: display });
          onOpen(org);
          return;
        }
      } catch (e) {
        // A refusal (used, expired, revoked) can never succeed: drop it. Anything
        // else (the cluster unreachable) is kept and tried on the next load.
        if (e instanceof CalimeroError && e.status < 500) dropInvite();
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      } finally {
        conn.after();
      }
      void refresh();
    })();
  }, [refresh, onOpen]);

  const create = async () => {
    const conn = connection();
    setBusy(true);
    setError(null);
    try {
      setMessengerDisplayName(username.trim());
      const { org } = await createWorkspace(conn.client, conn.source, name.trim(), conn.accountId, username.trim());
      onOpen(org);
    } catch (e) {
      setError(describeError(e));
    } finally {
      conn.after();
      setBusy(false);
    }
  };

  return (
    <Center>
      <Card>
        <h2>Workspaces</h2>
        {notice && <p>{notice}</p>}
        {workspaces === null && !error && <p>Loading…</p>}
        {workspaces?.length === 0 && <p>You are not in a workspace yet. Create one, or open an invitation link.</p>}
        {workspaces?.map((w) => (
          <button key={w.orgId} className="ghost" onClick={() => onOpen(w.orgId)}>
            {w.name || w.orgId} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {w.role}</span>
          </button>
        ))}
        <form
          style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && username.trim()) void create();
          }}
        >
          <p>New workspace</p>
          <input placeholder="Workspace name" aria-label="workspace name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Your name in it" aria-label="your name" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button type="submit" disabled={busy || !name.trim() || !username.trim()}>
            Create workspace
          </button>
        </form>
        {error && <pre className="err">{error}</pre>}
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </Card>
    </Center>
  );
}
