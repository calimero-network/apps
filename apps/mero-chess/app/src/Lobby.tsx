import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import type { AppSource, ClientRoutes } from "@calimero-apps/connect";

import { messageOf } from "./chess";
import { Piece } from "./pieces";
import type { OpenTable } from "./TablePage";
import { createTable, listTables } from "./tables";

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/**
 * Choose a table, or make one.
 *
 * v1's context picker. A table is an app instance, and it lives in an
 * organization (v1's namespace): "New table" makes both in one step, and
 * "Add table" puts another table in an organization you already have, so
 * everyone invited there reaches it too.
 */
export function Lobby({
  client,
  source,
  onOpen,
  after,
}: {
  client: ClientRoutes<{ apps: "list" | "create"; orgs: "create" }>;
  source: AppSource;
  onOpen: (table: OpenTable) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [tables, setTables] = useState<AppInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTables(await listTables(client, source));
      setFailed(null);
    } catch (e) {
      setFailed(messageOf(e));
    } finally {
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const orgs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of tables ?? []) if (t.org) seen.set(t.org, (seen.get(t.org) ?? 0) + 1);
    return [...seen.entries()];
  }, [tables]);

  async function make(key: string, org?: string) {
    setBusy(key);
    setFailed(null);
    try {
      const name = `Table ${(tables?.length ?? 0) + 1}`;
      const made = await createTable(client, source, name, org);
      after();
      onOpen({ appId: made.appId, name, org: made.org });
    } catch (e) {
      // Surfaced rather than swallowed: a refused `createApp` (INIT_FAILED,
      // a quota) is the only clue there is.
      setFailed(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div className="lobby-copy">
          <p className="eyebrow">Lobby</p>
          <h1>Sit down at a table</h1>
          <p className="lede">
            A table is one Calimero app: two seats and a move list, ordered by the cluster&apos;s
            log. No game server: the rules run in the contract, on every move.
          </p>
          <div className="row">
            <button className="large" onClick={() => void make("new")} disabled={busy !== null}>
              {busy === "new" ? "Creating…" : "New table"}
            </button>
            <button className="ghost large" onClick={() => void refresh()} disabled={busy !== null}>
              Refresh
            </button>
          </div>
          {failed && <pre className="err">{failed}</pre>}
        </div>
        <MiniBoard />
      </section>

      <div className="lobby-grid">
        <div className="card tables-card">
          <div className="card-head">
            <h2>Choose a table</h2>
            {tables && tables.length > 0 && <span className="count">{tables.length}</span>}
          </div>

          {tables === null && !failed && <p className="empty">Loading tables…</p>}

          {tables && tables.length === 0 && (
            <div className="empty-state">
              <Piece className="empty-piece" color="white" kind="n" />
              <p>No tables yet.</p>
              <p className="hint">Start one with New table, or open an invitation link someone sent you.</p>
            </div>
          )}

          {tables && tables.length > 0 && (
            <ul className="table-list">
              {tables.map((t, i) => (
                <li key={t.appId}>
                  <button className="table-item" onClick={() => onOpen({ appId: t.appId, name: t.name, org: t.org })}>
                    <span className={`table-icon ${i % 2 ? "alt" : ""}`} aria-hidden="true">
                      <Piece color={i % 2 ? "black" : "white"} kind={TABLE_ICONS[i % TABLE_ICONS.length] ?? "n"} />
                    </span>
                    <span className="table-text">
                      <span className="table-title">{t.name || `Table ${i + 1}`}</span>
                      <span className="table-id mono" title={t.appId}>
                        {t.appId}
                      </span>
                    </span>
                    <span className="open">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lobby-side">
          <div className="card ns-card">
            <div className="card-head">
              <h2>Organizations</h2>
            </div>
            <p className="hint">
              An organization is a club and each table in it is a board. Members are invited to the{" "}
              <em>organization</em>, which is why one invite link lets someone into every table in it.
            </p>
            {orgs.length === 0 && <p className="empty">None yet: New table creates one for you.</p>}
            {orgs.length > 0 && (
              <ul className="ns-list">
                {orgs.map(([org, count]) => (
                  <li key={org}>
                    <span className="mono ns-id" title={org}>
                      {shortId(org)} · {count} table{count === 1 ? "" : "s"}
                    </span>
                    <button className="ghost small" disabled={busy !== null} onClick={() => void make(org, org)}>
                      {busy === org ? "Creating…" : "Add table"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pieces the table list cycles through, so neighbouring rows are told apart at a glance. */
const TABLE_ICONS = ["n", "b", "r", "q", "k", "p"];

/** The opening position, decorative: what the lobby is about. */
function MiniBoard() {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const cells = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    for (let file = 0; file < 8; file += 1) {
      const kind = rank === 0 || rank === 7 ? back[file] : rank === 1 || rank === 6 ? "p" : null;
      cells.push(
        <span key={`${file}${rank}`} className={(file + rank) % 2 === 0 ? "dark" : "light"}>
          {kind && <Piece color={rank < 2 ? "white" : "black"} kind={kind} />}
        </span>,
      );
    }
  }
  return (
    <div className="mini-board" aria-hidden="true">
      {cells}
    </div>
  );
}
