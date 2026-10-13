import { useState } from "react";
import type { UpdateView } from "./generated/StandupClient";
import { describeDay, describeTime, shiftDay, today } from "./lib/days";
import { displayName, notYetPosted } from "./lib/people";
import { useRead, type useTeam } from "./useTeam";

type Team = ReturnType<typeof useTeam>;

/**
 * One day's standup: your update, everyone else's, who has not posted yet,
 * and what is blocking the team right now.
 */
export function StandupBoard({ team, me }: { team: Team; me: string | null }) {
  const { client, version, act } = team;
  const [day, setDay] = useState(() => today());
  const isToday = day === today();

  const board = useRead(client, version, (c) => c.getDay({ day }), [day]);
  const members = useRead(client, version, (c) => c.members(), []);
  const blockers = useRead(client, version, (c) => c.currentBlockers(), []);
  const days = useRead(client, version, (c) => c.listDays({ before: null, limit: 14 }), []);

  const updates = board.data?.day === day ? board.data.updates : [];
  const mine = updates.find((u) => u.author === me) ?? null;
  const others = updates.filter((u) => u.author !== me);
  const waiting = isToday && members.data ? notYetPosted(members.data, updates) : [];

  return (
    <>
      <div className="card">
        <div className="row day-nav">
          <button className="ghost" aria-label="previous day" onClick={() => setDay(shiftDay(day, -1))}>
            ←
          </button>
          <h2 className="day-title" data-testid="day-title">
            {describeDay(day)} <span className="dim mono">{day}</span>
          </h2>
          <button
            className="ghost"
            aria-label="next day"
            onClick={() => setDay(shiftDay(day, 1))}
            disabled={isToday}
          >
            →
          </button>
          {!isToday && (
            <button className="ghost" onClick={() => setDay(today())}>
              Today
            </button>
          )}
        </div>
        <MyUpdate key={`${day}:${mine?.edited_at ?? 0}`} day={day} mine={mine} act={act} />
      </div>

      <div className="card">
        <h2>Team</h2>
        {board.error && <pre className="err">{board.error}</pre>}
        {!board.data && board.loading && <p className="empty">Loading…</p>}
        {board.data && others.length === 0 && (
          <p className="empty">Nobody else has posted for {describeDay(day).toLowerCase()} yet.</p>
        )}
        <ul className="updates">
          {others.map((u) => (
            <UpdateCard key={u.author} update={u} />
          ))}
        </ul>
        {waiting.length > 0 && (
          <p className="empty waiting" data-testid="waiting">
            Not posted yet:{" "}
            {waiting.map((m) => displayName(m.account, m.name)).join(", ")}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Blocked right now</h2>
        <p className="empty" style={{ marginBottom: 10 }}>
          From each person&apos;s latest update. Post past a blocker and it drops off.
        </p>
        {blockers.data?.length === 0 && <p className="empty">Nothing is blocking anyone.</p>}
        <ul className="updates" data-testid="blockers">
          {blockers.data?.map((u) => (
            <li key={u.author} className="update blocker">
              <div className="byline">
                <strong>{displayName(u.author, u.author_name)}</strong>
                <button className="link" onClick={() => setDay(u.day)}>
                  {describeDay(u.day)}
                </button>
              </div>
              <p className="pre">{u.blockers}</p>
            </li>
          ))}
        </ul>
      </div>

      {days.data && days.data.days.length > 0 && (
        <div className="card">
          <h2>Recent days</h2>
          <div className="row">
            {days.data.days.map((d) => (
              <button
                key={d.day}
                className={d.day === day ? "chip active" : "chip"}
                onClick={() => setDay(d.day)}
                title={`${d.updates} update(s), ${d.blocked} blocked`}
              >
                {describeDay(d.day)} · {d.updates}
                {d.blocked > 0 && <span className="blocked-dot" aria-label="someone blocked" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function UpdateCard({ update }: { update: UpdateView }) {
  return (
    <li className={update.blockers ? "update has-blocker" : "update"}>
      <div className="byline">
        <strong>{displayName(update.author, update.author_name)}</strong>
        <span className="dim">{describeTime(update.edited_at)}</span>
      </div>
      <Field label="Done" text={update.done} />
      <Field label="Next" text={update.next} />
      <Field label="Blockers" text={update.blockers} danger />
    </li>
  );
}

function Field({ label, text, danger }: { label: string; text: string; danger?: boolean }) {
  if (!text) return null;
  return (
    <div className={danger ? "field danger" : "field"}>
      <span className="label">{label}</span>
      <p className="pre">{text}</p>
    </div>
  );
}

/**
 * Your own update for `day`: a form while you are writing, your posted update
 * otherwise. Re-keyed by the parent on the day and the stored edit, so the
 * form always starts from what the contract holds.
 */
function MyUpdate({
  day,
  mine,
  act,
}: {
  day: string;
  mine: UpdateView | null;
  act: Team["act"];
}) {
  const [editing, setEditing] = useState(mine === null);
  const [done, setDone] = useState(mine?.done ?? "");
  const [next, setNext] = useState(mine?.next ?? "");
  const [blockers, setBlockers] = useState(mine?.blockers ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <strong>Your update</strong>
          <span className="dim">{describeTime(mine.edited_at)}</span>
        </div>
        <Field label="Done" text={mine.done} />
        <Field label="Next" text={mine.next} />
        <Field label="Blockers" text={mine.blockers} danger />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="ghost danger-text"
            disabled={busy}
            onClick={() => void run(() => act((c) => c.clearUpdate({ day })))}
          >
            Withdraw
          </button>
        </div>
        {error && <pre className="err">{error}</pre>}
      </div>
    );
  }

  const empty = !done.trim() && !next.trim() && !blockers.trim();
  return (
    <form
      className="my-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => act((c) => c.postUpdate({ day, done, next, blockers })));
      }}
    >
      <label>
        <span className="label">Done</span>
        <textarea
          aria-label="done"
          rows={2}
          placeholder="What got done since your last update"
          value={done}
          onChange={(e) => setDone(e.target.value)}
        />
      </label>
      <label>
        <span className="label">Next</span>
        <textarea
          aria-label="next"
          rows={2}
          placeholder="What you are on next"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        <span className="label">Blockers</span>
        <textarea
          aria-label="blockers"
          rows={1}
          placeholder="Anything in your way? Leave empty if not"
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
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
      </div>
      {error && <pre className="err">{error}</pre>}
    </form>
  );
}
