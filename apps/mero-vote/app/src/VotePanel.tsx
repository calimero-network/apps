import { useCallback, useEffect, useState } from "react";
import type { Member, PollSummary } from "./generated/MeroVoteClient";
import { CreatePoll } from "./CreatePoll";
import { PollDetail } from "./PollDetail";
import { errText, short, useLiveRefresh, useMeroVote } from "./useMeroVote";

const PHASE_LABEL: Record<PollSummary["phase"], string> = {
  KeyCeremony: "Key ceremony",
  Voting: "Voting",
  Closing: "Closing",
  Closed: "Closed",
};

export function PhaseBadge({ phase }: { phase: PollSummary["phase"] }) {
  return <span className={`badge phase-${phase}`}>{PHASE_LABEL[phase]}</span>;
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
        <h2>You</h2>
        {me ? (
          <>
            <p className="empty" style={{ marginTop: 0 }}>
              {myName ? (
                <>
                  Signed in as <strong className="text">{myName}</strong>{" "}
                </>
              ) : (
                <>Pick a name so others can add you as a voter or trustee. </>
              )}
              · account <code className="mono">{short(me)}</code>
            </p>
            <div className="row">
              <input
                aria-label="Your name"
                placeholder={myName ? "Change your name" : "Your name"}
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void saveName()}
              />
              <button onClick={() => void saveName()} disabled={!name.trim()}>
                {myName ? "Rename" : "Join roster"}
              </button>
            </div>
          </>
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
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Polls</h2>
            <div className="row">
              <button className="ghost" onClick={() => void refresh()}>
                Refresh
              </button>
              <button onClick={() => setCreating(true)} disabled={!me}>
                New poll
              </button>
            </div>
          </div>
          {polls.length === 0 ? (
            <p className="empty">No polls in this context yet.</p>
          ) : (
            <ul className="poll-list">
              {polls.map((p) => (
                <li key={p.poll_id}>
                  <button className="poll-row" onClick={() => setSelected(p.poll_id)}>
                    <span className="poll-title">{p.title}</span>
                    <span className="empty">
                      by {label(p.creator)} · {p.ballots} ballot{p.ballots === 1 ? "" : "s"}
                    </span>
                    <PhaseBadge phase={p.phase} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <h2>Members ({roster.length})</h2>
        {roster.length === 0 ? (
          <p className="empty">Nobody has joined the roster yet.</p>
        ) : (
          <div className="chips">
            {roster.map((m) => (
              <span key={m.account} className="chip" title={m.account}>
                {m.name}
                {m.account === me && " (you)"}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
