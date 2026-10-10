import { useCallback, useEffect, useState } from "react";
import type { MemberView } from "../generated/MeroModelsClient";
import { useModelsClient } from "../editor/hooks";
import { memberColor, shortId } from "../editor/model";
import { useEditor } from "../editor/store";
import { messageOf } from "../editor/sync";
import type { Peer } from "../editor/viewport";
import { InviteCard } from "../InviteCard";
import { IconClose } from "../ui/icons";

/**
 * Who is in this scene, and who may change it.
 *
 * Everyone in the context can open the scene and look; the admin (whoever
 * created it) decides who may edit. The contract enforces that on every node,
 * so the toggle here is the real permission, not a UI hint.
 */
export function SharePanel({
  contextId,
  name,
  onName,
  peers,
  onFollow,
  onClose,
}: {
  contextId: string;
  name: string;
  onName: (name: string) => void;
  peers: Peer[];
  onFollow: (peer: Peer) => void;
  onClose: () => void;
}) {
  const client = useModelsClient(contextId);
  const me = useEditor((s) => s.me);
  const role = useEditor((s) => s.role);
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setMembers(await client.getMembers());
    } catch (e) {
      setError(messageOf(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function setEditor(member: MemberView, editor: boolean) {
    if (!client) return;
    setBusy(member.id);
    setError(null);
    try {
      if (editor) await client.grantEditor({ member: member.id });
      else await client.revokeEditor({ member: member.id });
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const online = new Set(peers.map((p) => p.name));

  return (
    <div className="share-panel" role="dialog" aria-label="Share">
      <header className="share-head">
        <h2>Share</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </header>

      <label className="share-name">
        <span>Your name</span>
        <input
          defaultValue={name}
          maxLength={80}
          placeholder="Guest"
          onBlur={(e) => onName(e.target.value.trim())}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>

      {peers.length > 0 && (
        <section>
          <h3>Here now</h3>
          <ul className="peer-list">
            {peers.map((p) => (
              <li key={p.key}>
                <span className="avatar" style={{ background: p.color }}>
                  {initial(p.name)}
                </span>
                <span className="peer-name">{p.name}</span>
                <span className="peer-sel">{p.selection.length ? `${p.selection.length} selected` : "looking around"}</span>
                <button type="button" className="ghost small" disabled={!p.camera} onClick={() => onFollow(p)}>
                  Go to view
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Members</h3>
        {!members && <p className="hint">Loading…</p>}
        {members && members.length === 0 && <p className="hint">Nobody has joined yet.</p>}
        {members && members.length > 0 && (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="avatar" style={{ background: memberColor(m.id) }}>
                  {initial(m.name)}
                </span>
                <span className="member-text">
                  <span className="member-name">
                    {m.name}
                    {m.id === me && <span className="you"> (you)</span>}
                    {online.has(m.name) && m.id !== me && <span className="online-dot" title="Online" />}
                  </span>
                  <span className="mono member-id" title={m.id}>
                    {shortId(m.id)}
                  </span>
                </span>
                {m.role === "admin" ? (
                  <span className="role-badge admin">Admin</span>
                ) : role === "admin" ? (
                  <label className="role-toggle">
                    <input
                      type="checkbox"
                      checked={m.role === "editor"}
                      disabled={busy === m.id}
                      onChange={(e) => void setEditor(m, e.target.checked)}
                    />
                    <span>Can edit</span>
                  </label>
                ) : (
                  <span className={`role-badge ${m.role}`}>{m.role === "editor" ? "Editor" : "Viewer"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <pre className="err">{error}</pre>}
        <p className="hint">
          Anyone you invite can open the scene and watch it change. {role === "admin" ? "Tick Can edit" : "The admin ticks Can edit"} to let them
          change it — every node enforces that, not just this screen.
        </p>
      </section>

      <InviteCard contextId={contextId} />
    </div>
  );
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
