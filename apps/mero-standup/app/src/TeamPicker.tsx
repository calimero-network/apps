import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import { describeError, type AppSource, type ClientRoutes } from "@calimero-apps/connect";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { MeroStandupClient, type AppTransport } from "./generated/client";
import { decodeText } from "./standup";
import { createTeam, listTeams } from "./teams";

type PickerClient = AppTransport &
  ClientRoutes<{
    apps: "list" | "create" | "call" | "view";
    orgs: "create" | "get" | "memberMetadata";
  }>;

/**
 * v1's context picker: the teams this account reaches (app instances of this
 * app), and a new one. A new team is an organization with the app in it, named
 * with `setTeamName` so every member sees the same name. Your name in it is
 * asked here, once, and kept on the org.
 */
export function TeamPicker({
  client,
  accountId,
  source,
  onOpen,
  after,
}: {
  client: PickerClient;
  accountId: string;
  source: AppSource;
  onOpen: (app: Pick<AppInfo, "appId" | "name" | "org">) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [teams, setTeams] = useState<AppInfo[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [teamName, setTeamName] = useState("");
  const [myName, setMyName] = useState(() => lastUsedName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const found = await listTeams(client, source);
      setTeams(found);
      setError(null);
      // The name the team gave itself, which a member may have changed since
      // the instance was created. Best-effort: the instance name stands in.
      const pairs = await Promise.all(
        found.map(async (t) => {
          try {
            return [t.appId, decodeText(await new MeroStandupClient(client, t.appId, { after }).teamName())] as const;
          } catch {
            return [t.appId, ""] as const;
          }
        }),
      );
      setNames(Object.fromEntries(pairs));
    } catch (e) {
      setError(describeError(e));
    } finally {
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const name = teamName.trim();
    setBusy(true);
    setError(null);
    try {
      const { appId, org } = await createTeam(client, source, name);
      after();
      // Best effort: the team exists either way, and opening it asks once
      // when the org has no name for you.
      await setOrgName(client, org, accountId, myName).catch(() => {});
      await new MeroStandupClient(client, appId, { after }).setTeamName({ name });
      onOpen({ appId, name, org });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Your teams</h2>
        {teams === null && !error && <p className="empty">Loading…</p>}
        {teams?.length === 0 && (
          <p className="empty">No teams yet. Start one, or open an invitation link someone sent you.</p>
        )}
        {teams && teams.length > 0 && (
          <ul className="team-list">
            {teams.map((t) => (
              <li key={t.appId}>
                <button className="team-row" onClick={() => onOpen(t)}>
                  <span className="team-row-name">{names[t.appId] || t.name || <span className="dim">Unnamed team</span>}</span>
                  <span className="mono dim">{t.appId.length > 12 ? `${t.appId.slice(0, 8)}…` : t.appId}</span>
                  <span className="team-row-open">Open →</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (teamName.trim() && myName.trim()) void create();
        }}
      >
        <h2>Start a team</h2>
        <p className="empty" style={{ marginBottom: 10 }}>
          A new organization with this team in it. Invite teammates from the team&apos;s Invite tab.
        </p>
        <div className="row">
          <input
            aria-label="team name"
            placeholder="Team name, e.g. Platform"
            maxLength={80}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
          <input
            aria-label="your name in this team"
            placeholder="Your name in this team"
            maxLength={64}
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
          />
          <button type="submit" disabled={busy || !teamName.trim() || !myName.trim()}>
            {busy ? "Starting…" : "Start a new team"}
          </button>
        </div>
      </form>
      {error && <pre className="err">{error}</pre>}
    </>
  );
}
