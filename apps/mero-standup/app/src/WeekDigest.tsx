import { useState } from "react";
import { byPerson, digestMarkdown } from "./lib/digest";
import { describeWeek, shiftDay, today, weekStart, weekdayShort } from "./lib/days";
import { displayName } from "./lib/people";
import { Avatar, Icon, RichText } from "./ui";
import { useRead, type Team } from "./useTeam";

/**
 * A week of standups, one column of updates per person: what a weekly report
 * or a 1:1 needs, without anyone retyping it. Copy as Markdown to paste it
 * somewhere else — the only path by which this data leaves the team, and only
 * when someone presses the button.
 */
export function WeekDigest({ team }: { team: Team }) {
  const [start, setStart] = useState(() => weekStart(today()));
  const week = useRead(team.client, team.version, (c) => c.getWeek({ start }), [start]);
  const teamName = useRead(team.client, team.version, (c) => c.teamName(), []);
  const [copied, setCopied] = useState(false);
  const people = week.data ? byPerson(week.data) : [];
  const thisWeek = start === weekStart(today());

  async function copy() {
    if (!week.data) return;
    try {
      await navigator.clipboard.writeText(digestMarkdown(teamName.data ?? "", start, week.data));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head week-head">
        <button className="ghost icon-button" aria-label="previous week" onClick={() => setStart(shiftDay(start, -7))}>
          <Icon name="left" />
        </button>
        <h2 data-testid="week-title">
          {thisWeek ? "This week" : "Week of"} <span className="dim">{describeWeek(start)}</span>
        </h2>
        <button
          className="ghost icon-button"
          aria-label="next week"
          disabled={thisWeek}
          onClick={() => setStart(shiftDay(start, 7))}
        >
          <Icon name="right" />
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={() => void copy()} disabled={!week.data}>
          <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy as Markdown"}
        </button>
      </div>

      {week.error && <pre className="err">{week.error}</pre>}
      {week.data && people.length === 0 && <p className="empty">No updates this week.</p>}

      <div className="digest" data-testid="digest">
        {people.map((p) => (
          <article key={p.account} className="digest-person">
            <header className="byline">
              <Avatar account={p.account} name={p.name} />
              <strong>{displayName(p.account, p.name)}</strong>
              <span className="dim">
                {p.updates.length} day{p.updates.length === 1 ? "" : "s"}
              </span>
            </header>
            <ol className="digest-days">
              {p.updates.map((u) => (
                <li key={u.day} className={u.blockers ? "has-blocker" : ""}>
                  <span className="digest-day">{weekdayShort(u.day)}</span>
                  <div>
                    {u.done && <RichText text={u.done} />}
                    {u.next && (
                      <p className="dim small">
                        Next: {u.next.split("\n")[0]}
                      </p>
                    )}
                    {u.blockers && <p className="danger small">Blocked: {u.blockers.split("\n")[0]}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
