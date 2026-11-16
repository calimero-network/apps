import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";
import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { createGroup, listGroups } from "./groups";
import { PACKAGE } from "./meroVote";
import { errText } from "./useMeroVote";
import { BoxIcon, ChevronRightIcon, PlusIcon, RefreshIcon } from "./icons";
import { IconTile, IdField } from "./ui";

export type OpenedGroup = Pick<AppInfo, "appId" | "name" | "org">;

const CREATE_LABELS = {
  title: "New voting group",
  subtitle: "Name your voting group. It lives in an organization of its own, whose members you invite.",
  nameLabel: "Group name",
  namePlaceholder: "e.g. Offsite committee",
  selfLabel: "Your name in this group",
  selfPlaceholder: "e.g. Ana",
};

/**
 * v1's context picker: the voting groups this account reaches (instances of
 * this app), and a new one. A new group is an organization with the app in
 * it, so its members can be invited (v1: a namespace with a context in it). The
 * organization comes from the shared dialog, which also asks your name in it.
 */
export function GroupPicker({
  client,
  accountId,
  source,
  passkey,
  onOpen,
  after,
}: {
  client: CalimeroClient;
  accountId: string;
  source: AppSource;
  passkey: () => PasskeyProvider;
  onOpen: (group: OpenedGroup) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [groups, setGroups] = useState<AppInfo[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const { source: release, pending: releasePending } = useResolvedSource(client, accountId, source);
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

  async function created({ orgId, name, selfName }: { orgId: string; name: string; selfName: string }) {
    setShowCreate(false);
    setBusy(true);
    setError(null);
    try {
      const { appId, org } = await createGroup(client, source, name, orgId);
      after();
      // Best effort: the group exists either way.
      await setOrgName(client, org, accountId, selfName).catch(() => {});
      onOpen({ appId, name, org });
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

      <div className="card row">
        <button type="button" onClick={() => setShowCreate(true)} disabled={busy}>
          <PlusIcon size={16} />
          {busy ? "Creating…" : "Create voting group"}
        </button>
      </div>
      <CreateWorkspaceDialog
        client={client}
        passkey={passkey()}
        release={releasePending ? null : (reviewRelease(release) ?? { package: PACKAGE })}
        defaultSelfName={lastUsedName()}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={created}
        labels={CREATE_LABELS}
      />
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
