import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import { askAnOwnerCopy, canCreateIn, type AppSource, type ClientRoutes } from "@calimero-apps/connect";

import { createArena, listArenas } from "./arenas";
import type { OpenArena } from "./ArenaPage";
import { Portrait } from "./FighterSelect";
import { ROSTER } from "./game/fighters";
import { messageOf } from "./kombat";

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/**
 * Choose an arena, or make one.
 *
 * v1's context picker. An arena is an app instance, and it lives in an
 * organization (v1's namespace): "New arena" makes both in one step, and
 * "Add arena" puts another arena in an organization you already have, so
 * everyone invited there reaches it too.
 */
export function Lobby({
  client,
  source,
  onOpen,
  after,
}: {
  client: Pick<CalimeroClient, "session"> & ClientRoutes<{ apps: "list" | "create"; orgs: "create" | "get" }>;
  source: AppSource;
  onOpen: (arena: OpenArena) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [arenas, setArenas] = useState<AppInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setArenas(await listArenas(client, source));
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
    for (const a of arenas ?? []) if (a.org) seen.set(a.org, (seen.get(a.org) ?? 0) + 1);
    return [...seen.entries()];
  }, [arenas]);

  // Who may add an arena to each organization (core's CREATE_APP rule): a
  // member who may not is told to ask an owner instead of a button that
  // fails. Unknown (`null`, the org unreadable) keeps the button.
  const orgKey = orgs.map(([org]) => org).join(",");
  const [mayAdd, setMayAdd] = useState<Record<string, boolean | null>>({});
  useEffect(() => {
    let live = true;
    for (const org of orgKey ? orgKey.split(",") : []) {
      void canCreateIn(client, org).then((may) => {
        if (live) setMayAdd((m) => ({ ...m, [org]: may }));
      });
    }
    return () => {
      live = false;
    };
  }, [client, orgKey]);

  async function make(key: string, org?: string) {
    setBusy(key);
    setFailed(null);
    try {
      const name = `Arena ${(arenas?.length ?? 0) + 1}`;
      const made = await createArena(client, source, name, org);
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
          <h1>Enter the arena</h1>
          <p className="lede">
            An arena is one Calimero app: two corners and every blow thrown, ordered by the
            cluster&apos;s log. No game server: each punch is a transaction the contract executes.
          </p>
          <div className="row">
            <button className="large" onClick={() => void make("new")} disabled={busy !== null}>
              {busy === "new" ? "Creating…" : "New arena"}
            </button>
            <button className="ghost large" onClick={() => void refresh()} disabled={busy !== null}>
              Refresh
            </button>
          </div>
          {failed && <pre className="err">{failed}</pre>}
        </div>
        <LobbyArt />
      </section>

      <div className="lobby-grid">
        <div className="card tables-card">
          <div className="card-head">
            <h2>Choose an arena</h2>
            {arenas && arenas.length > 0 && <span className="count">{arenas.length}</span>}
          </div>

          {arenas === null && !failed && <p className="empty">Loading arenas…</p>}

          {arenas && arenas.length === 0 && (
            <div className="empty-state">
              <Portrait id="kinetic" size={64} className="empty-piece" />
              <p>No arenas yet.</p>
              <p className="hint">Start one with New arena, or open an invitation link someone sent you.</p>
            </div>
          )}

          {arenas && arenas.length > 0 && (
            <ul className="table-list">
              {arenas.map((a, i) => (
                <li key={a.appId}>
                  <button
                    className="table-item"
                    onClick={() => onOpen({ appId: a.appId, name: a.name, org: a.org })}
                  >
                    <span className="table-icon" aria-hidden="true">
                      <Portrait id={ROSTER[i % ROSTER.length].id} size={44} />
                    </span>
                    <span className="table-text">
                      <span className="table-title">{a.name || `Arena ${i + 1}`}</span>
                      <span className="table-id mono" title={a.appId}>
                        {a.appId}
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
              An organization is a dojo and each arena in it is a ring. Opponents are invited to the{" "}
              <em>organization</em>, which is why one invite link lets someone into every arena in it.
            </p>
            {orgs.length === 0 && <p className="empty">None yet: New arena creates one for you.</p>}
            {orgs.length > 0 && (
              <ul className="ns-list">
                {orgs.map(([org, count]) => (
                  <li key={org}>
                    <span className="mono ns-id" title={org}>
                      {shortId(org)} · {count} arena{count === 1 ? "" : "s"}
                    </span>
                    {mayAdd[org] === false ? (
                      <p className="hint" data-testid="ask-an-owner">
                        {askAnOwnerCopy("an arena")}
                      </p>
                    ) : (
                      <button className="ghost small" disabled={busy !== null} onClick={() => void make(org, org)}>
                        {busy === org ? "Creating…" : "Add arena"}
                      </button>
                    )}
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

/** Two fighters squaring up: what the lobby is about. */
function LobbyArt() {
  return (
    <div className="lobby-art" aria-hidden="true">
      <Portrait id="kinetic" size={132} />
      <span className="lobby-vs">VS</span>
      <Portrait id="inferno" size={132} facing={-1} />
    </div>
  );
}
