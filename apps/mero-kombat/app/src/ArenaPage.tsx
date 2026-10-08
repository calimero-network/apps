import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearContextId } from "@calimero-network/mero-react";
import { ArrowLeft, Refresh, Target } from "@calimero-network/mero-icons";
import { useNavigate } from "react-router-dom";
import { ArenaCanvas } from "./ArenaCanvas";
import { ChainPanel } from "./ChainPanel";
import { FighterSelect, Portrait } from "./FighterSelect";
import { InviteCard } from "./InviteCard";
import { SoundToggle } from "./SoundToggle";
import { TouchPad } from "./TouchPad";
import type { Slice } from "./game/controller";
import { fighterOf, type FighterId } from "./game/fighters";
import type { Button } from "./game/input";
import type { ArenaView, FighterView, MatchSummary } from "./generated/MeroKombatClient";
import {
  rememberFighter,
  rememberName,
  storedFighter,
  storedName,
  toArenaState,
  useAnnounce,
  useArena,
  usePastMatches,
} from "./useArena";

/**
 * One arena: the cabinet, the two corners, the chain meter, and the link that
 * brings an opponent in.
 */
export function ArenaPage({ contextId }: { contextId: string }) {
  const arena = useArena(contextId);
  const navigate = useNavigate();
  const [name, setName] = useState(storedName);
  const [fighter, setFighter] = useState<FighterId>(storedFighter);
  const [press, setPress] = useState<((b: Button, down: boolean) => void) | null>(null);
  useAnnounce(contextId, name, fighter);

  const view = arena.view;
  const past = usePastMatches(contextId, `${view?.match_index ?? 0}:${view?.winner ?? ""}`);
  const state = useMemo(() => (view ? toArenaState(view) : null), [view]);
  const mySeat = view?.my_seat ?? "";
  const local = mySeat === "p1" ? 0 : mySeat === "p2" ? 1 : null;
  const mode = local === null ? "spectate" : "net";
  const fighting = view?.status === "fighting" && local !== null;

  // Who is streaming right now — the honest "online" for a fight.
  const lastSeen = useRef<Record<string, number>>({});
  const [live, setLive] = useState<Record<string, boolean>>({});
  const { subscribe: rawSubscribe } = arena;
  const subscribe = useCallback(
    (handler: (s: Slice) => void) =>
      rawSubscribe((s) => {
        if (s?.seat) lastSeen.current[s.seat] = performance.now();
        handler(s);
      }),
    [rawSubscribe],
  );
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = performance.now();
      setLive({
        p1: now - (lastSeen.current.p1 ?? -1e9) < 4000,
        p2: now - (lastSeen.current.p2 ?? -1e9) < 4000,
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const hooks = useMemo(() => ({ act: arena.act, publish: arena.publish }), [arena.act, arena.publish]);
  const onControls = useCallback((fn: (b: Button, down: boolean) => void) => setPress(() => fn), []);

  function switchArena() {
    clearContextId();
    window.location.reload();
  }

  function choose(id: FighterId) {
    setFighter(id);
    rememberFighter(id);
    if (mySeat) void arena.pick(id);
  }

  const canvasFighters: [FighterId, FighterId] = [
    (view?.p1.fighter as FighterId) || "kinetic",
    (view?.p2.fighter as FighterId) || "cryo",
  ];

  return (
    <div className="arena-page">
      {arena.error && (
        <div className="card alert" role="alert">
          <pre className="err" data-testid="error">
            {arena.error}
          </pre>
          <button className="ghost small" onClick={arena.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className="arena-head">
        <div className="arena-title">
          <p className="eyebrow">Arena · Match {(view?.match_index ?? 0) + 1}</p>
          <h1>{view?.title ?? "Arena"}</h1>
        </div>
        <div className="row">
          <StatusPill view={view} live={live} />
          <SoundToggle />
          <button className="ghost small" onClick={() => navigate("/practice")}>
            <Target size={15} aria-hidden="true" /> Practice
          </button>
          <button className="ghost small" onClick={switchArena}>
            <ArrowLeft size={15} aria-hidden="true" /> Arenas
          </button>
        </div>
      </div>

      <div className="arena-layout">
        <section className="cabinet-col">
          <div className="cabinet">
            {!view ? (
              <div className="cabinet-loading">
                <span className="spinner" aria-hidden="true" />
                <p>Reading the arena…</p>
              </div>
            ) : (
              <ArenaCanvas
                mode={mode}
                local={local}
                fighters={canvasFighters}
                state={state}
                hooks={mode === "net" ? hooks : null}
                subscribe={subscribe}
                onControls={onControls}
                label={`${view.p1.name || "Corner 1"} versus ${view.p2.name || "Corner 2"}`}
              />
            )}
          </div>
          {mode === "net" ? (
            <TouchPad press={press} />
          ) : (
            <p className="hint center">You are watching. Take a free corner to fight.</p>
          )}
        </section>

        <aside className="side-col">
          {/* Mid-fight the meter is the point; before it, choosing a fighter is. */}
          {fighting ? (
            <>
          <ChainPanel
            stats={arena.stats}
            totalActions={Number(view?.total_actions ?? 0)}
            matchActions={view?.match_actions ?? 0}
          />
          {view && (
            <CornersCard
              view={view}
              live={live}
              name={name}
              fighter={fighter}
              busy={arena.busy}
              onName={(n) => {
                setName(n);
                rememberName(n);
              }}
              onChoose={choose}
              onSit={(seat) => void arena.sit(seat, name, fighter)}
              onStand={() => void arena.stand()}
              onRematch={() => void arena.rematch()}
            />
          )}
            </>
          ) : (
            <>
          {view && (
            <CornersCard
              view={view}
              live={live}
              name={name}
              fighter={fighter}
              busy={arena.busy}
              onName={(n) => {
                setName(n);
                rememberName(n);
              }}
              onChoose={choose}
              onSit={(seat) => void arena.sit(seat, name, fighter)}
              onStand={() => void arena.stand()}
              onRematch={() => void arena.rematch()}
            />
          )}
          <ChainPanel
            stats={arena.stats}
            totalActions={Number(view?.total_actions ?? 0)}
            matchActions={view?.match_actions ?? 0}
          />
            </>
          )}
          <InviteCard contextId={contextId} />
          <History past={past} view={view} />
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ view, live }: { view: ArenaView | null; live: Record<string, boolean> }) {
  if (!view) return null;
  const text =
    view.status === "waiting"
      ? "Waiting for fighters"
      : view.status === "finished"
        ? "Match over"
        : live.p1 && live.p2
          ? `Round ${view.round + 1} · live`
          : `Round ${view.round + 1}`;
  return (
    <span className={`status-pill ${view.status}`} data-testid="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

function CornersCard({
  view,
  live,
  name,
  fighter,
  busy,
  onName,
  onChoose,
  onSit,
  onStand,
  onRematch,
}: {
  view: ArenaView;
  live: Record<string, boolean>;
  name: string;
  fighter: FighterId;
  busy: boolean;
  onName: (n: string) => void;
  onChoose: (id: FighterId) => void;
  onSit: (seat: "p1" | "p2") => void;
  onStand: () => void;
  onRematch: () => void;
}) {
  const seated = view.my_seat !== "";
  const corner = (f: FighterView) => {
    const mine = f.member !== "" && f.member === view.me;
    const empty = f.member === "";
    return (
      <li className={`corner ${empty ? "empty" : ""} ${mine ? "mine" : ""}`} data-testid={`corner-${f.seat}`}>
        {empty ? (
          <span className="corner-empty" aria-hidden="true">
            ?
          </span>
        ) : (
          <Portrait id={f.fighter} size={44} facing={f.seat === "p1" ? 1 : -1} />
        )}
        <span className="corner-text">
          <span className="corner-name">
            {empty ? "Open corner" : f.name}
            {mine && <span className="you"> · you</span>}
          </span>
          <span className="corner-sub">
            {empty ? (f.seat === "p1" ? "Left side" : "Right side") : fighterOf(f.fighter).name}
            {!empty && (
              <>
                {" · "}
                <span className={`presence ${live[f.seat] ? "online" : ""}`} aria-hidden="true" />
                {live[f.seat] ? "in the arena" : "away"}
              </>
            )}
          </span>
        </span>
        <span className="corner-score" title="Matches won">
          {f.matches_won}
        </span>
        {empty && !seated && (
          <button className="small" disabled={busy} onClick={() => onSit(f.seat as "p1" | "p2")} data-testid={`sit-${f.seat}`}>
            Fight here
          </button>
        )}
        {mine && view.match_actions === 0 && view.match_index === 0 && (
          <button className="ghost small" disabled={busy} onClick={onStand}>
            Leave
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="card corners-card">
      <div className="card-head">
        <h2>Fighters</h2>
        {view.status === "finished" && seated && (
          <button className="small" disabled={busy} onClick={onRematch} data-testid="rematch">
            <Refresh size={14} aria-hidden="true" /> Rematch
          </button>
        )}
      </div>
      <ul className="corners">
        {corner(view.p1)}
        <li className="versus" aria-hidden="true">
          VS
        </li>
        {corner(view.p2)}
      </ul>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={24}
          placeholder="Fighter"
          aria-label="your name"
          onChange={(e) => onName(e.target.value)}
          disabled={seated}
        />
      </label>
      <FighterSelect value={fighter} onChange={onChoose} disabled={busy} />
    </div>
  );
}

function History({ past, view }: { past: MatchSummary[]; view: ArenaView | null }) {
  const done = past.filter((m) => m.winner !== "");
  if (!view || done.length === 0) return null;
  const nameOf = (seat: string) => (seat === "p1" ? view.p1.name : seat === "p2" ? view.p2.name : "Draw");
  return (
    <div className="card history-card">
      <div className="card-head">
        <h2>Record</h2>
        <span className="count">{done.length}</span>
      </div>
      <ul className="history">
        {done
          .slice()
          .reverse()
          .slice(0, 6)
          .map((m) => (
            <li key={m.index}>
              <span className="history-match">Match {m.index + 1}</span>
              <span className="history-winner">
                {m.winner === "draw" ? "Draw" : `${nameOf(m.winner)} wins`}
                {m.flawless && <span className="flawless">Flawless</span>}
              </span>
              <span className="history-tx mono">{m.actions} tx</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
