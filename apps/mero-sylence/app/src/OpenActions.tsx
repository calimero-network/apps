import { useMemo, useState } from "react";
import { PlatformMark } from "./PlatformMark";
import { Icon } from "./ui";
import "./shell.css";
import type { ActionView, MeetingView } from "./sylenceApi";
import { PersonName } from "./names";
import { formatWhen } from "./lib/transcript";
import { useRead, type Workspace } from "./useWorkspace";

/** Every action item not yet done, across the workspace's meetings, grouped by meeting. */
export function OpenActions({ workspace, onOpen }: { workspace: Workspace; onOpen: (meetingId: string) => void }) {
  const actions = useRead(workspace.client, workspace.version, (c) => c.openActions(), []);
  const meetings = useRead(workspace.client, workspace.version, (c) => c.listMeetings(), []);
  return (
    <OpenActionsList
      actions={actions.data}
      meetings={meetings.data}
      error={actions.error}
      onToggle={(a) => void workspace.act((c) => c.setActionDone({ actionId: a.id, done: true }))}
      onOpen={onOpen}
    />
  );
}

export function OpenActionsList({
  actions,
  meetings,
  error,
  onToggle,
  onOpen,
}: {
  actions: ActionView[] | null;
  meetings: MeetingView[] | null;
  error?: string | null;
  onToggle: (a: ActionView) => void;
  onOpen: (meetingId: string) => void;
}) {
  const groups = useMemo(() => {
    if (!actions) return null;
    const byMeeting = new Map<string, ActionView[]>();
    for (const a of actions) byMeeting.set(a.meetingId, [...(byMeeting.get(a.meetingId) ?? []), a]);
    return [...byMeeting.entries()].map(([id, items]) => ({ meeting: meetings?.find((m) => m.id === id) ?? null, id, items }));
  }, [actions, meetings]);

  if (error && !actions) return <pre className="err">{error}</pre>;
  if (!groups) return <section className="card"><p className="empty">Loading…</p></section>;
  if (groups.length === 0) {
    return (
      <section className="card" data-testid="no-open-actions">
        <h2>Nothing open</h2>
        <p className="empty">Every action item from your meetings is done.</p>
      </section>
    );
  }
  return <OpenGroups groups={groups} onToggle={onToggle} onOpen={onOpen} />;
}

type Group = { meeting: MeetingView | null; id: string; items: ActionView[] };

/** A few calls open at once; more than that, only the newest two start open. */
const OPEN_AT_START = 3;

/** Each call's open items in a section that folds: which call they came from, at a glance. */
function OpenGroups({
  groups,
  onToggle,
  onOpen,
}: {
  groups: Group[];
  onToggle: (a: ActionView) => void;
  onOpen: (meetingId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.slice(0, groups.length <= OPEN_AT_START ? groups.length : 2).map((g) => g.id)),
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const allOpen = groups.every((g) => open.has(g.id));
  const toggle = (id: string, to: boolean) =>
    setOpen((s) => {
      const next = new Set(s);
      if (to) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <div className="open-actions">
      <div className="open-actions-head">
        <span className="dim">
          {total} open {total === 1 ? "item" : "items"} from {groups.length} {groups.length === 1 ? "call" : "calls"}
        </span>
        {groups.length > 1 && (
          <button type="button" className="btn small ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.id)))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>
      {groups.map((g) => {
        const title = g.meeting?.title || "Meeting";
        return (
          <details
            className="card oa-group"
            key={g.id}
            open={open.has(g.id)}
            onToggle={(e) => toggle(g.id, (e.currentTarget as HTMLDetailsElement).open)}
            data-testid="open-action-group"
          >
            <summary className="oa-summary">
              <Icon name="right" size={14} />
              <PlatformMark platform={g.meeting?.platform ?? "other"} size={28} />
              <span className="oa-title">
                <h2>{title}</h2>
                {g.meeting && <span className="dim small">{formatWhen(g.meeting.startedAt)}</span>}
              </span>
              <span className="oa-count">{g.items.length}</span>
              <button
                type="button"
                className="btn small ghost oa-open"
                aria-label={`Open ${title}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(g.id);
                }}
              >
                Open call
              </button>
            </summary>
            <ul className="action-list">
              {g.items.map((a) => (
                <li className="action" key={a.id} data-testid="open-action">
                  <label className="action-check">
                    <input type="checkbox" checked={false} onChange={() => onToggle(a)} aria-label={`Done: ${a.text}`} />
                    <span className="action-text">{a.text}</span>
                  </label>
                  <span className="action-meta">
                    {a.assignee && <span className="pill">{a.assignee}</span>}
                    <span className="dim">
                      added by <PersonName account={a.createdBy} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
