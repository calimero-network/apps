import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  JOIN_SYNC_POLL_MS,
  isNamespaceJustJoined,
  useContextGroup,
  useJoinSync,
  useMero,
} from "@calimero-network/mero-react";
import { publishMemberName, useMemberNames } from "@calimero-apps/names";
import type { Member, PollSummary } from "./generated/MeroVoteClient";
import { CreatePoll } from "./CreatePoll";
import { PollDetail } from "./PollDetail";
import { errText, short, useLiveRefresh, useMeroVote } from "./useMeroVote";
import { BarChartIcon, CheckIcon, ChevronRightIcon, ClockIcon, KeyIcon, PlusIcon, RefreshIcon, UserIcon, UsersIcon } from "./icons";

const PHASE_LABEL: Record<PollSummary["phase"], string> = {
  KeyCeremony: "Key ceremony",
  Voting: "Voting",
  Closing: "Closing",
  Closed: "Closed",
};

const PHASES: PollSummary["phase"][] = ["KeyCeremony", "Voting", "Closing", "Closed"];

export function PhaseBadge({ phase }: { phase: PollSummary["phase"] }) {
  return (
    <span className={`badge phase-${phase}`}>
      <span className="dot" />
      {PHASE_LABEL[phase]}
    </span>
  );
}

/**
 * Everything inside one context: who you are, who else is here, the polls.
 *
 * The roster is how the app learns account ids. A creator names trustees and
 * voters by ACCOUNT, and the only place an account id appears is the member's
 * own signed slot — which `set_name` creates.
 *
 * It owns the two columns: the polls in the main one, and who you are, who
 * else is here and `side` (the invite card) beside them.
 */
export function VotePanel({
  contextId,
  joinedNamespace = null,
  side,
}: {
  contextId: string;
  /** The namespace, when the context was just joined in this page. */
  joinedNamespace?: string | null;
  side?: ReactNode;
}) {
  const client = useMeroVote(contextId);
  const { admin } = useMero();
  // `ContextPicker` creates contexts directly in the namespace, so the
  // context's group IS the namespace (see `InviteCard`) — where the name a
  // person set for every app on it lives.
  const { groupId: namespaceId } = useContextGroup(contextId);
  const { nameOf } = useMemberNames(admin, namespaceId);
  const [me, setMe] = useState<string | null>(null);
  const [roster, setRoster] = useState<Member[]>([]);
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [who, r, p] = await Promise.all([client.whoami(), client.roster(), client.listPolls()]);
      setMe(who.account);
      setRoster(r);
      setPolls(p);
      setErr(null);
      setTick((t) => t + 1);
    } catch (e) {
      setErr(errText(e));
    }
  }, [client]);

  useEffect(() => void refresh(), [refresh]);
  useLiveRefresh(contextId, () => void refresh());

  // Ends the invitation dialog's "Syncing…" for a context just joined: `tick`
  // moves on every read of the polls that came back. Right after the join an
  // empty list is what a node that has not synced the context returns, so it
  // does not settle while the namespace is flagged just-joined; the watchdog
  // clears the flag, after which a context with no polls reads as empty again.
  // This app's contexts live directly in the namespace (see ContextPicker), so
  // the context's group is the namespace that was joined.
  const syncNamespace = joinedNamespace ?? namespaceId;
  const { isSyncing } = useJoinSync({
    namespaceId: syncNamespace,
    settled: tick > 0 && (polls.length > 0 || !isNamespaceJustJoined(syncNamespace)),
    // Still empty: let the gate wait up to its ceiling, not the base window.
    active: polls.length === 0,
  });

  // Polls that land after the join need not raise an event here, so while the
  // gate is up, re-read on a timer.
  useEffect(() => {
    if (!isSyncing) return;
    const timer = setInterval(() => void refresh(), JOIN_SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [isSyncing, refresh]);

  const names = new Map(roster.map((m) => [m.account, m.name]));
  const myName = me ? names.get(me) : undefined;
  // The roster name, else the name this person set for the namespace, else the
  // short id: someone who never joined this roster is still not a key.
  const label = (account: string) => names.get(account) || nameOf(account) || short(account);
  const spaceName = me ? nameOf(me) : undefined;

  // Offer the namespace name as the roster name, so joining is one click.
  useEffect(() => {
    if (me && !myName && spaceName) setName((n) => n || spaceName);
  }, [me, myName, spaceName]);

  async function saveName() {
    if (!client || !name.trim()) return;
    // The namespace-wide name too, so every app on it shows this name.
    // Best-effort: the roster name is what was asked for, and a refusal here
    // must not report it as failed.
    if (admin && namespaceId && me) {
      void publishMemberName(admin, namespaceId, me, name.trim()).catch(() => undefined);
    }
    try {
      await client.setName({ name: name.trim() });
      setName("");
      await refresh();
    } catch (e) {
      setErr(errText(e));
    }
  }

  if (selected) {
    return (
      <div className="ctx-layout">
        <div className="ctx-main">
          <PollDetail
            key={selected}
            contextId={contextId}
            pollId={selected}
            me={me}
            label={label}
            tick={tick}
            onBack={() => setSelected(null)}
          />
        </div>
        <aside className="ctx-side">{side}</aside>
      </div>
    );
  }

  const count = (...phases: PollSummary["phase"][]) => polls.filter((p) => phases.includes(p.phase)).length;

  return (
    <div className="ctx-layout">
      <div className="ctx-main">
        {err && <pre className="err">{err}</pre>}
        {creating && me ? (
          <CreatePoll
            contextId={contextId}
            me={me}
            selfName={spaceName}
            roster={roster}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setSelected(id);
              void refresh();
            }}
          />
        ) : (
          <section className="card polls-panel">
            <div className="page-head">
              <div>
                <span className="eyebrow">Voting group</span>
                <h2>Polls</h2>
                <p>
                  {polls.length} poll{polls.length === 1 ? "" : "s"} in this context. Ballots are encrypted in each
                  voter&apos;s browser; every member can audit the count.
                </p>
              </div>
              <div className="page-actions">
                <button className="icon-btn round bordered" onClick={() => void refresh()} title="Refresh" aria-label="Refresh">
                  <RefreshIcon size={16} />
                </button>
                <button onClick={() => setCreating(true)} disabled={!me}>
                  <PlusIcon size={16} />
                  New poll
                </button>
              </div>
            </div>
            <div className="stats">
              <div className="stat">
                <span className="stat-icon live">
                  <BarChartIcon size={16} />
                </span>
                <span className="stat-num tnum">{count("Voting")}</span>
                <span className="stat-label">Open for voting</span>
              </div>
              <div className="stat">
                <span className="stat-icon wait">
                  <KeyIcon size={16} />
                </span>
                <span className="stat-num tnum">{count("KeyCeremony")}</span>
                <span className="stat-label">In key ceremony</span>
              </div>
              <div className="stat">
                <span className="stat-icon">
                  <CheckIcon size={16} />
                </span>
                <span className="stat-num tnum">{count("Closing", "Closed")}</span>
                <span className="stat-label">Closed or counting</span>
              </div>
            </div>

            {polls.length === 0 ? (
              <div className="empty-state hero-empty">
                <span className="empty-mark">
                  <BarChartIcon size={24} />
                </span>
                <strong>No polls yet</strong>
                <p>
                  No polls in this context yet. Start one with <strong className="text">New poll</strong> — ballots are
                  encrypted in each voter&apos;s browser.
                </p>
              </div>
            ) : (
              <ul className="poll-grid">
                {polls.map((p) => {
                  const at = PHASES.indexOf(p.phase);
                  return (
                    <li key={p.poll_id}>
                      <button className={`poll-card phase-card-${p.phase}`} onClick={() => setSelected(p.poll_id)}>
                        <span className="poll-card-top">
                          <PhaseBadge phase={p.phase} />
                          <ChevronRightIcon size={16} className="chev" />
                        </span>
                        <span className="poll-title">{p.title}</span>
                        <span className="poll-meta">
                          <span className="poll-meta-item">
                            <UserIcon size={13} />
                            {label(p.creator)}
                          </span>
                          <span className="poll-meta-item tnum">
                            {p.phase === "KeyCeremony" ? <ClockIcon size={13} /> : <CheckIcon size={13} />}
                            {p.ballots} ballot{p.ballots === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="poll-progress" aria-hidden="true">
                          {PHASES.map((ph, i) => (
                            <span key={ph} className={i < at ? "done" : i === at ? "now" : ""} />
                          ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      <aside className="ctx-side">
        {/*
          `needs-name` lifts this card above the polls in the one-column layout
          (index.css): a first-time visitor's first job is picking a name, and
          until they do they cannot be added as a voter or trustee. Two columns
          already show it beside the polls, so nothing moves there.
        */}
        <div className={`card you-card ${me && !myName ? "needs-name" : ""}`}>
          <div className="card-head">
            <span className={`avatar lg ${myName ? "me" : ""}`}>{myName ? initial(myName) : <UserIcon size={18} />}</span>
            <div className="grow">
              <h2>You</h2>
              {me && (
                <div className="meta">
                  {myName ? (
                    <>
                      Signed in as <strong className="text">{myName}</strong>
                    </>
                  ) : (
                    <>Pick a name so others can add you as a voter or trustee.</>
                  )}
                </div>
              )}
            </div>
          </div>
          {me ? (
            <>
              <div className="account-line">
                <span>Account</span>
                <code className="mono" title={me}>
                  {short(me)}
                </code>
              </div>
              <div className="row name-row">
                <input
                  aria-label="Your name"
                  placeholder={myName ? "Change your name" : "Your name"}
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveName()}
                />
                <button className={myName ? "ghost" : ""} onClick={() => void saveName()} disabled={!name.trim()}>
                  {myName ? "Rename" : "Join roster"}
                </button>
              </div>
            </>
          ) : (
            <p className="empty">Loading…</p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="icon-tile">
              <UsersIcon size={18} />
            </span>
            <div className="grow">
              <h2>Members ({roster.length})</h2>
              <div className="meta">Everyone here can vote and audit</div>
            </div>
          </div>
          {roster.length === 0 ? (
            <p className="empty">Nobody has joined the roster yet.</p>
          ) : (
            <ul className="member-list">
              {roster.map((m) => (
                <li key={m.account} className="member" title={m.account} data-testid="member">
                  <span className={`avatar ${m.account === me ? "me" : ""}`}>{initial(label(m.account))}</span>
                  <span className="member-name">
                    {label(m.account)}
                    {m.account === me && <span className="you"> (you)</span>}
                  </span>
                  <code className="mono member-id">{short(m.account)}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
        {side}
      </aside>
    </div>
  );
}

function initial(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}
