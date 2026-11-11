import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import type { AppSource, ClientRoutes } from "@calimero-apps/connect";
import { createGroup, listGroups } from "./groups";
import { errText } from "./useMeroVote";
import { BoxIcon, ChevronRightIcon, PlusIcon, RefreshIcon } from "./icons";
import { IconTile, IdField } from "./ui";

export type OpenedGroup = Pick<AppInfo, "appId" | "name" | "org">;

/**
 * v1's context picker: the voting groups this account reaches (instances of
 * this app), and a new one. A new group is an organization with the app in
 * it, so its members can be invited (v1: a namespace with a context in it).
 */
export function GroupPicker({
  client,
  source,
  onOpen,
  after,
}: {
  client: ClientRoutes<{ apps: "list" | "create"; orgs: "create" }>;
  source: AppSource;
  onOpen: (group: OpenedGroup) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [groups, setGroups] = useState<AppInfo[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await listGroups(client, source));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const groupName = name.trim();
    setBusy(true);
    setError(null);
    try {
      const { appId, org } = await createGroup(client, source, groupName);
      after();
      onOpen({ appId, name: groupName, org });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Choose a voting group</h2>
          <p>
            A voting group is one app instance: its members, its polls and its ballot box. It lives in an
            organization of its own, whose members you invite.
          </p>
        </div>
        <div className="page-actions">
          <button className="ghost" onClick={() => void refresh()} disabled={groups === null && !error}>
            <RefreshIcon size={16} />
            Refresh
          </button>
        </div>
      </div>

      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <input
          aria-label="Group name"
          placeholder="Group name, e.g. Offsite committee"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          <PlusIcon size={16} />
          {busy ? "Creating…" : "Create voting group"}
        </button>
      </form>
      {error && <pre className="err">{error}</pre>}

      <div className="section-head">
        <h3>
          <BoxIcon size={16} />
          Voting groups <span className="count">{groups?.length ?? 0}</span>
        </h3>
      </div>

      {groups === null && !error && <p className="empty">Loading voting groups…</p>}

      {groups?.length === 0 && (
        <div className="empty-state">
          <IconTile>
            <BoxIcon size={20} />
          </IconTile>
          <strong>No voting groups yet</strong>
          <p>
            Create one above, or open an invitation link someone sent you.
          </p>
        </div>
      )}

      {groups && groups.length > 0 && (
        <div className="grid-cards">
          {groups.map((g) => (
            <div className="card entity-card" key={g.appId}>
              <div className="entity-top">
                <IconTile accent>
                  <BoxIcon size={18} />
                </IconTile>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="entity-title">{g.name || "Voting group"}</div>
                  <IdField value={g.appId} label="app id" />
                </div>
              </div>
              <div className="entity-foot">
                <span className="empty">{g.org ? "Polls, members, ballot box" : "Only you"}</span>
                <button className="sm" onClick={() => onOpen(g)}>
                  Open
                  <ChevronRightIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
