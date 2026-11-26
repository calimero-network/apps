import { useMemo } from "react";
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
  return (
    <div className="open-actions">
      {groups.map((g) => (
        <section className="card" key={g.id}>
          <div className="card-head">
            <button type="button" className="link-btn" onClick={() => onOpen(g.id)}>
              <h2>{g.meeting?.title ?? "Meeting"}</h2>
            </button>
            {g.meeting && <span className="dim">{formatWhen(g.meeting.startedAt)}</span>}
          </div>
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
        </section>
      ))}
    </div>
  );
}
