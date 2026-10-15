import { useState } from "react";
import { useJoinSync } from "@calimero-network/mero-react";
import type { UpdateView } from "./generated/StandupClient";
import { carryForward, type Draft } from "./lib/carry";
import {
  describeDay,
  relativeTime,
  shiftDay,
  today,
  weekDays,
  weekStart,
  weekdayShort,
} from "./lib/days";
import { displayName, notYetPosted } from "./lib/people";
import type { DecisionDraft } from "./DecisionLog";
import { Avatar, Icon, isSubmitShortcut, RichText, SUBMIT_HINT } from "./ui";
import { useRead, type Team } from "./useTeam";

/**
 * One day's standup: your update, everyone else's, who has not posted yet,
 * and what is blocking the team right now.
 */
export function StandupBoard({
  team,
  namespaceId,
  me,
  onLogDecision,
}: {
  team: Team;
  /** The team's namespace, whose just-joined flag a first read here clears. */
  namespaceId: string | null;
  me: string | null;
  onLogDecision: (draft: DecisionDraft) => void;
}) {
  const { client, version, act } = team;
  const [day, setDay] = useState(() => today());
  const isToday = day === today();

  const board = useRead(client, version, (c) => c.getDay({ day }), [day]);
  // Ends the invitation dialog's "Syncing…" for a team just joined: a day's
  // updates read back, none posted included. A team whose state has not
  // arrived yet fails the read, and it is retried on every event and poll.
  useJoinSync({ namespaceId, settled: board.data !== null });
  const members = useRead(client, version, (c) => c.members(), []);
  const blockers = useRead(client, version, (c) => c.currentBlockers(), []);
  const decided = useRead(
    client,
    version,
    (c) =>
      c.listDecisions({
        search: null,
        tag: null,
        from_day: day,
        standing_only: false,
        cursor: null,
        limit: 10,
      }),
    [day],
  );

  const updates = board.data?.day === day ? board.data.updates : [];
  const mine = updates.find((u) => u.author === me) ?? null;
  const others = updates.filter((u) => u.author !== me);
  const waiting = isToday && members.data ? notYetPosted(members.data, updates) : [];
  const myLastDay = members.data?.find((m) => m.account === me)?.last_day ?? "";

  return (
    <div className="board">
      <div className="board-main">
        <WeekStrip team={team} day={day} setDay={setDay} />

        <section className="card">
          <MyUpdate
            key={`${day}:${mine?.edited_at ?? 0}`}
            team={team}
            day={day}
            mine={mine}
            me={me}
            lastDay={myLastDay < day ? myLastDay : ""}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Team</h2>
            <span className="dim">{others.length > 0 ? `${others.length} posted` : ""}</span>
          </div>
          {board.error && <pre className="err">{board.error}</pre>}
          {!board.data && board.loading && <p className="empty">Loading…</p>}
          {board.data && others.length === 0 && (
            <p className="empty">
              {isToday
                ? "Nobody else has posted today yet. Updates appear here as teammates' nodes sync."
                : `Nobody else posted for ${describeDay(day).toLowerCase()}.`}
            </p>
          )}
          <ul className="updates">
            {others.map((u) => (
              <UpdateCard
                key={u.author}
                update={u}
                me={me}
                act={act}
                onLogDecision={() => onLogDecision({ fromDay: u.day })}
              />
            ))}
          </ul>
        </section>

        {decided.data && decided.data.items.length > 0 && (
          <section className="card">
            <h2>Decided {isToday ? "today" : `on ${describeDay(day)}`}</h2>
            <ul className="mini-list">
              {decided.data.items.map((d) => (
                <li key={d.id}>
                  <strong>{d.title}</strong>
                  <span className="dim"> — {d.decision}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="board-side">
        {isToday && (
          <section className="card side">
            <h3>Not posted yet</h3>
            {waiting.length === 0 ? (
              <p className="empty">Everyone the app knows about has posted.</p>
            ) : (
              <ul className="people" data-testid="waiting">
                {waiting.map((m) => (
                  <li key={m.account}>
                    <Avatar account={m.account} name={m.name} size={22} />
                    {displayName(m.account, m.name)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="card side">
          <h3>Blocked right now</h3>
          {blockers.data?.length === 0 && <p className="empty">Nothing is blocking anyone.</p>}
          <ul className="blocker-list" data-testid="blockers">
            {blockers.data?.map((u) => (
              <li key={u.author}>
                <div className="byline">
                  <Avatar account={u.author} name={u.author_name} size={22} />
                  <strong>{u.author === me ? "You" : displayName(u.author, u.author_name)}</strong>
                  <button className="link" onClick={() => setDay(u.day)}>
                    {describeDay(u.day)}
                  </button>
                </div>
                <RichText text={u.blockers} className="blocker-text" />
                <HelpLine update={u} me={me} act={act} compact />
              </li>
            ))}
          </ul>
        </section>

        <section className="card side">
          <h3>Tips</h3>
          <p className="empty">
            Start a line with <code>-</code> for a list. Links and <code>`code`</code> just work.
            Press {SUBMIT_HINT} to post.
          </p>
        </section>
      </aside>
    </div>
  );
}

/** The week around `day`, a dot per day someone posted, red if anyone was blocked. */
function WeekStrip({
  team,
  day,
  setDay,
}: {
  team: Team;
  day: string;
  setDay: (d: string) => void;
}) {
  const start = weekStart(day);
  const week = useRead(team.client, team.version, (c) => c.getWeek({ start }), [start]);
  const t = today();
  return (
    <div className="week-strip card">
      <div className="week-row">
      <button
        className="ghost icon-button"
        aria-label="previous day"
        onClick={() => setDay(shiftDay(day, -1))}
      >
        <Icon name="left" />
      </button>
      <div className="week-days">
        {weekDays(start).map((d, i) => {
          const view = week.data?.[i];
          const count = view?.updates.length ?? 0;
          const blocked = view?.updates.some((u) => u.blockers) ?? false;
          const future = d > t;
          return (
            <button
              key={d}
              className={["week-day", d === day ? "active" : "", d === t ? "is-today" : ""].join(" ")}
              disabled={future}
              onClick={() => setDay(d)}
              aria-label={`${describeDay(d)}, ${count} update${count === 1 ? "" : "s"}`}
            >
              <span className="wd">{weekdayShort(d)}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="dots">
                {count > 0 && <span className={blocked ? "dot blocked" : "dot"} />}
                {count > 1 && <span className="count">{count}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <button
        className="ghost icon-button"
        aria-label="next day"
        onClick={() => setDay(shiftDay(day, 1))}
        disabled={day >= t}
      >
        <Icon name="right" />
      </button>
      </div>
      <h2 className="day-title" data-testid="day-title">
        {describeDay(day)}
        {day !== t && (
          <button className="link today-link" onClick={() => setDay(t)}>
            Today
          </button>
        )}
      </h2>
    </div>
  );
}

function UpdateCard({
  update,
  me,
  act,
  onLogDecision,
}: {
  update: UpdateView;
  me: string | null;
  act: Team["act"];
  onLogDecision: () => void;
}) {
  return (
    <li className={update.blockers ? "update has-blocker" : "update"}>
      <div className="byline">
        <Avatar account={update.author} name={update.author_name} />
        <div className="who">
          <strong>{displayName(update.author, update.author_name)}</strong>
          <span className="dim" title={new Date(update.edited_at / 1e6).toLocaleString()}>
            {relativeTime(update.edited_at)}
            {update.edited_at !== update.created_at && " · edited"}
          </span>
        </div>
        <button className="link quiet" onClick={onLogDecision} title="Log a decision that came out of this">
          Log decision
        </button>
      </div>
      <Fields update={update} />
      {update.blockers && <HelpLine update={update} me={me} act={act} />}
    </li>
  );
}

function Fields({ update }: { update: Pick<UpdateView, "done" | "next" | "blockers"> }) {
  return (
    <div className="fields">
      {update.done && (
        <div className="field">
          <span className="label">Done</span>
          <RichText text={update.done} />
        </div>
      )}
      {update.next && (
        <div className="field">
          <span className="label">Next</span>
          <RichText text={update.next} />
        </div>
      )}
      {update.blockers && (
        <div className="field danger">
          <span className="label">Blocked</span>
          <RichText text={update.blockers} />
        </div>
      )}
    </div>
  );
}

/**
 * Who offered help on a blocker, and your own offer: make one (with an
 * optional note), or take it back. Not shown on your own blocker's controls.
 */
function HelpLine({
  update,
  me,
  act,
  compact,
}: {
  update: UpdateView;
  me: string | null;
  act: Team["act"];
  compact?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offered = update.helpers.some((h) => h.account === me);
  const isMine = update.author === me;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="help-line">
      {update.helpers.length > 0 && (
        <ul className="helpers" data-testid="helpers">
          {update.helpers.map((h) => (
            <li key={h.account}>
              <Avatar account={h.account} name={h.name} size={20} />
              <span>
                <strong>{h.account === me ? "You" : displayName(h.account, h.name)}</strong>{" "}
                {h.note ? <span className="dim">— {h.note}</span> : <span className="dim">can help</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!isMine && me && !compact && (
        <>
          {offered ? (
            <button
              className="link quiet"
              disabled={busy}
              onClick={() =>
                void run(() => act((c) => c.withdrawHelp({ day: update.day, author: update.author })))
              }
            >
              Withdraw your offer
            </button>
          ) : note === null ? (
            <button className="chip help-button" onClick={() => setNote("")}>
              <Icon name="hand" size={14} /> I can help
            </button>
          ) : (
            <form
              className="row help-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  act((c) => c.offerHelp({ day: update.day, author: update.author, note })),
                );
              }}
            >
              <input
                aria-label="how you can help"
                autoFocus
                maxLength={500}
                placeholder="How? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setNote(null)}
              />
              <button type="submit" disabled={busy}>
                {busy ? "Offering…" : "Offer help"}
              </button>
              <button type="button" className="ghost" onClick={() => setNote(null)}>
                Cancel
              </button>
            </form>
          )}
        </>
      )}
      {error && <pre className="err">{error}</pre>}
    </div>
  );
}

/**
 * Your own update for `day`: a form while you are writing, your posted update
 * otherwise. Re-keyed by the parent on the day and the stored edit, so the
 * form always starts from what the contract holds.
 *
 * With nothing posted yet, the form starts from your LAST update before this
 * day (`lastDay`): its "next" becomes this "done". Nothing is posted until you
 * press Post.
 */
function MyUpdate({
  team,
  day,
  mine,
  me,
  lastDay,
}: {
  team: Team;
  day: string;
  mine: UpdateView | null;
  me: string | null;
  lastDay: string;
}) {
  const { act } = team;
  const previous = useRead(
    team.client,
    0,
    (c) => (lastDay && !mine ? c.getDay({ day: lastDay }) : Promise.resolve(null)),
    [lastDay, mine === null],
  );
  const last = previous.data?.updates.find((u) => u.author === me) ?? null;

  const [editing, setEditing] = useState(mine === null);
  const [draft, setDraft] = useState<Draft | null>(
    mine ? { done: mine.done, next: mine.next, blockers: mine.blockers } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Until you type, the form shows the carried-forward draft; your first
  // keystroke takes it over.
  const carried = !mine && draft === null && last !== null;
  const value: Draft = draft ?? (mine ? mine : carryForward(last));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setDraft({ ...value, [k]: e.target.value });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing && mine) {
    return (
      <div className="update mine" data-testid="my-update">
        <div className="byline">
          {me && <Avatar account={me} name={mine.author_name} />}
          <div className="who">
            <strong>Your update</strong>
            <span className="dim">{relativeTime(mine.edited_at)}</span>
          </div>
          <span className="badge">Posted</span>
        </div>
        <Fields update={mine} />
        {mine.helpers.length > 0 && <HelpLine update={mine} me={me} act={act} compact />}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="ghost danger-text"
            disabled={busy}
            onClick={() => void run(() => act((c) => c.clearUpdate({ day })))}
          >
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
        {error && <pre className="err">{error}</pre>}
      </div>
    );
  }

  const empty = !value.done.trim() && !value.next.trim() && !value.blockers.trim();
  const submit = () => {
    if (busy || empty) return;
    void run(() => act((c) => c.postUpdate({ day, ...value })));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="my-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="card-head">
        <h2>{mine ? "Edit your update" : day === today() ? "Your update for today" : `Your update for ${describeDay(day)}`}</h2>
        {carried && (
          <span className="hint" data-testid="carried">
            Started from your {describeDay(lastDay).toLowerCase()} update
          </span>
        )}
      </div>
      <label>
        <span className="label">Done</span>
        <textarea
          aria-label="done"
          rows={3}
          placeholder="What got done since your last update"
          value={value.done}
          onChange={set("done")}
          onKeyDown={onKeyDown}
        />
      </label>
      <label>
        <span className="label">Next</span>
        <textarea
          aria-label="next"
          rows={2}
          placeholder="What you are on next"
          value={value.next}
          onChange={set("next")}
          onKeyDown={onKeyDown}
        />
      </label>
      <label>
        <span className="label">Blockers</span>
        <textarea
          aria-label="blockers"
          rows={1}
          placeholder="Anything in your way? Leave empty if not"
          value={value.blockers}
          onChange={set("blockers")}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="row">
        <button type="submit" disabled={busy || empty}>
          {busy ? "Posting…" : mine ? "Save update" : "Post update"}
        </button>
        {mine && (
          <button type="button" className="ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
        <span className="dim kbd-hint">{SUBMIT_HINT}</span>
      </div>
      {error && <pre className="err">{error}</pre>}
    </form>
  );
}
