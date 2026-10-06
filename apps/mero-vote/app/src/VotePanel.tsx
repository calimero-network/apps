import { useCallback, useEffect, useState } from "react";
import type { Member, PollSummary } from "./generated/MeroVoteClient";
import { CreatePoll } from "./CreatePoll";
import { PollDetail } from "./PollDetail";
import { errText, short, useLiveRefresh, useMeroVote } from "./useMeroVote";
import { BarChartIcon, ChevronRightIcon, PlusIcon, RefreshIcon, UserIcon, UsersIcon } from "./icons";
import { IconTile } from "./ui";

const PHASE_LABEL: Record<PollSummary["phase"], string> = {
  KeyCeremony: "Key ceremony",
  Voting: "Voting",
  Closing: "Closing",
  Closed: "Closed",
};

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
 */
export function VotePanel({ contextId }: { contextId: string }) {
  const client = useMeroVote(contextId);
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

  const names = new Map(roster.map((m) => [m.account, m.name]));
  const myName = me ? names.get(me) : undefined;
  const label = (account: string) => names.get(account) ?? short(account);

  async function saveName() {
    if (!client || !name.trim()) return;
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
      <PollDetail
        key={selected}
        contextId={contextId}
        pollId={selected}
        me={me}
        label={label}
        tick={tick}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: me ? 14 : 0 }}>
          <span className={`avatar ${myName ? "me" : ""}`}>{myName ? initial(myName) : <UserIcon size={14} />}</span>
          <div className="grow">
            <h2>You</h2>
            {me && (
              <div className="meta">
                {myName ? (
                  <>
                    Signed in as <strong className="text">{myName}</strong>{" "}
                  </>
                ) : (
                  <>Pick a name so others can add you as a voter or trustee. </>
                )}
                · account <code className="mono" title={me}>{short(me)}</code>
              </div>
            )}
          </div>
        </div>
        {me ? (
          <div className="row">
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
        ) : (
          <p className="empty">Loading…</p>
        )}
        {err && <pre className="err">{err}</pre>}
      </div>

      {creating && me ? (
        <CreatePoll
          contextId={contextId}
          me={me}
          roster={roster}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
            void refresh();
          }}
        />
      ) : (
        <div className="card flush">
          <div className="card-head">
            <div className="grow">
              <h2>Polls</h2>
              <div className="meta">
                {polls.length} poll{polls.length === 1 ? "" : "s"} in this context
              </div>
            </div>
            <div className="actions">
              <button className="icon-btn bordered" onClick={() => void refresh()} title="Refresh" aria-label="Refresh">
                <RefreshIcon size={16} />
              </button>
              <button onClick={() => setCreating(true)} disabled={!me}>
                <PlusIcon size={16} />
                New poll
              </button>
            </div>
          </div>
          {polls.length === 0 ? (
            <div style={{ padding: "0 20px 20px" }}>
              <div className="empty-state">
                <IconTile>
                  <BarChartIcon size={20} />
                </IconTile>
                <strong>No polls yet</strong>
                <p>No polls in this context yet. Start one — ballots are encrypted in each voter&apos;s browser.</p>
              </div>
            </div>
          ) : (
            <ul className="poll-list">
              {polls.map((p) => (
                <li key={p.poll_id}>
                  <button className="poll-row" onClick={() => setSelected(p.poll_id)}>
                    <IconTile accent={p.phase === "Voting"}>
                      <BarChartIcon size={18} />
                    </IconTile>
                    <span className="poll-main">
                      <span className="poll-title">{p.title}</span>
                      <span className="poll-meta">
                        by {label(p.creator)} · {p.ballots} ballot{p.ballots === 1 ? "" : "s"}
                      </span>
                    </span>
                    <PhaseBadge phase={p.phase} />
                    <ChevronRightIcon size={16} className="chev" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="grow">
            <h2>Members ({roster.length})</h2>
          </div>
          <UsersIcon size={16} className="muted" />
        </div>
        {roster.length === 0 ? (
          <p className="empty">Nobody has joined the roster yet.</p>
        ) : (
          <div className="chips">
            {roster.map((m) => (
              <span key={m.account} className="chip" title={m.account} data-testid="member">
                <span className={`avatar ${m.account === me ? "me" : ""}`}>{initial(m.name)}</span>
                {m.name}
                {m.account === me && <span className="you">(you)</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function initial(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}
