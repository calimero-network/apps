import type { DayView, UpdateView } from "../generated/StandupClient";
import { describeWeek, weekdayShort } from "./days";
import { displayName } from "./people";

export interface PersonWeek {
  account: string;
  name: string;
  /** Their updates in day order, only days they posted. */
  updates: UpdateView[];
}

/** A week of standups regrouped by person, people in name order. */
export function byPerson(week: DayView[]): PersonWeek[] {
  const people = new Map<string, PersonWeek>();
  for (const day of week) {
    for (const u of day.updates) {
      const p = people.get(u.author) ?? { account: u.author, name: u.author_name, updates: [] };
      // The latest name wins: someone may have renamed themselves mid-week.
      if (u.author_name) p.name = u.author_name;
      p.updates.push(u);
      people.set(u.author, p);
    }
  }
  return [...people.values()].sort((a, b) =>
    displayName(a.account, a.name).localeCompare(displayName(b.account, b.name)),
  );
}

/**
 * The week as plain Markdown, for pasting into a weekly report or a chat. The
 * one place this app turns team data into something that leaves it — on the
 * user's explicit Copy, never automatically.
 */
export function digestMarkdown(teamName: string, start: string, week: DayView[]): string {
  const lines = [`# ${teamName || "Team"} — week of ${describeWeek(start)}`, ""];
  const people = byPerson(week);
  if (people.length === 0) lines.push("_No updates this week._");
  for (const p of people) {
    lines.push(`## ${displayName(p.account, p.name)}`, "");
    for (const u of p.updates) {
      lines.push(`**${weekdayShort(u.day)}**`);
      if (u.done) lines.push(`- Done: ${u.done.replace(/\n+/g, "; ")}`);
      if (u.next) lines.push(`- Next: ${u.next.replace(/\n+/g, "; ")}`);
      if (u.blockers) lines.push(`- Blocked: ${u.blockers.replace(/\n+/g, "; ")}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
