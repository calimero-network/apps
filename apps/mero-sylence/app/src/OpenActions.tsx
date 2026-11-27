import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Trash } from "@calimero-network/mero-icons";
import { AssigneeChip, useMemberNames } from "./Assignee";
import { assignables, assigneeColor, assigneeInitials, sameName, type Assignable } from "./lib/assignee";
import { PlatformMark } from "./PlatformMark";
import { Icon } from "./ui";
import "./shell.css";
import type { ActionView, MeetingView } from "./sylenceApi";
import { PersonName } from "./names";
import { formatWhen } from "./lib/transcript";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * Every open action item across the workspace's meetings, by call or by
 * person. An item ticked here stays in the list, ticked, until the page is
 * left (the contract's `openActions` lists open items only); unticking it
 * opens it again.
 */
export function OpenActions({ workspace, onOpen }: { workspace: Workspace; onOpen: (meetingId: string) => void }) {
  const open = useRead(workspace.client, workspace.version, (c) => c.openActions(), []);
  const meetings = useRead(workspace.client, workspace.version, (c) => c.listMeetings(), []);
  const actions = useKeptDone(open.data);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <OpenActionsList
        actions={actions.list}
        meetings={meetings.data}
        error={open.error}
        onToggle={(a) =>
          run(async () => {
            actions.mark(a.id, !a.done);
            await workspace.act((c) => c.setActionDone({ actionId: a.id, done: !a.done }));
          })
        }
        onAssign={(a, who) => run(() => workspace.act((c) => c.editAction({ actionId: a.id, text: a.text, assignee: who })))}
        onEdit={(a, text) => run(() => workspace.act((c) => c.editAction({ actionId: a.id, text, assignee: a.assignee })))}
        onRemove={(a) =>
          run(async () => {
            await workspace.act((c) => c.removeAction({ actionId: a.id }));
            actions.forget(a.id);
          })
        }
        onOpen={onOpen}
      />
    </>
  );
}

/**
 * The open items, plus the ones ticked here since the page opened, kept in
 * place and marked done, so a tick does not make an item jump out of view.
 */
function useKeptDone(open: ActionView[] | null) {
  const seen = useRef(new Map<string, ActionView>());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    for (const a of open ?? []) seen.current.set(a.id, a);
  }, [open]);
  const list = useMemo(() => {
    if (!open) return null;
    const openIds = new Set(open.map((a) => a.id));
    const kept = [...seen.current.values()].filter((a) => !openIds.has(a.id) && done.has(a.id) && !gone.has(a.id));
    return [...open.filter((a) => !gone.has(a.id)).map((a) => (done.has(a.id) ? { ...a, done: true } : a)), ...kept.map((a) => ({ ...a, done: true }))];
  }, [open, done, gone]);
  return {
    list,
    mark: (id: string, isDone: boolean) =>
      setDone((s) => {
        const next = new Set(s);
        if (isDone) next.add(id);
        else next.delete(id);
        return next;
      }),
    forget: (id: string) => setGone((s) => new Set(s).add(id)),
  };
}

type Handlers = {
  onToggle: (a: ActionView) => void;
  /** Absent: assignees only show. */
  onAssign?: (a: ActionView, who: string) => void;
  onEdit?: (a: ActionView, text: string) => void;
  onRemove?: (a: ActionView) => void;
  onOpen: (meetingId: string) => void;
};

export function OpenActionsList({
  actions,
  meetings,
  error,
  ...handlers
}: {
  actions: ActionView[] | null;
  meetings: MeetingView[] | null;
  error?: string | null;
} & Handlers) {
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
  return <OpenGroups groups={groups} {...handlers} />;
}

type Group = { meeting: MeetingView | null; id: string; items: ActionView[] };

/** A few calls open at once; more than that, only the newest two start open. */
const OPEN_AT_START = 3;

/** Each call's items in a section that folds, or the same items by person. */
function OpenGroups({ groups, ...handlers }: { groups: Group[] } & Handlers) {
  const [view, setView] = useState<"call" | "person">("call");
  const memberNames = useMemberNames();
  const people = useMemo(() => assignables([], memberNames), [memberNames]);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.slice(0, groups.length <= OPEN_AT_START ? groups.length : 2).map((g) => g.id)),
  );
  const items = groups.flatMap((g) => g.items);
  const left = items.filter((a) => !a.done).length;
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
          {left} open {left === 1 ? "item" : "items"} from {groups.length} {groups.length === 1 ? "call" : "calls"}
        </span>
        <div className="segmented oa-view" role="radiogroup" aria-label="Group by">
          {(["call", "person"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {v === "call" ? "By call" : "By person"}
            </button>
          ))}
        </div>
        {view === "call" && groups.length > 1 && (
          <button type="button" className="btn small ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.id)))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>
      {view === "person" ? (
        <ByPerson groups={groups} people={people} {...handlers} />
      ) : (
        groups.map((g) => {
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
                <span className="oa-count">{g.items.filter((a) => !a.done).length}</span>
                <button
                  type="button"
                  className="btn small ghost oa-open"
                  aria-label={`Open ${title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handlers.onOpen(g.id);
                  }}
                >
                  Open call
                </button>
              </summary>
              <ul className="action-list">
                {g.items.map((a) => (
                  <OpenRow key={a.id} action={a} people={people} {...handlers}>
                    <span className="dim">
                      added by <PersonName account={a.createdBy} />
                    </span>
                  </OpenRow>
                ))}
              </ul>
            </details>
          );
        })
      )}
    </div>
  );
}

/** One item: tick it, assign it, edit or remove it. */
function OpenRow({
  action: a,
  people,
  onToggle,
  onAssign,
  onEdit,
  onRemove,
  children,
}: { action: ActionView; people: readonly Assignable[]; children?: React.ReactNode } & Handlers) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    return (
      <li className="action editing" data-testid="open-action">
        <form
          className="action-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onEdit?.(a, draft.trim());
            setDraft(null);
          }}
        >
          <input
            aria-label="Action item text"
            autoFocus
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
          />
          <button type="submit" className="btn small primary">
            Save
          </button>
          <button type="button" className="btn small ghost" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      </li>
    );
  }
  return (
    <li className={a.done ? "action done" : "action"} data-testid="open-action">
      <label className="action-check">
        <input type="checkbox" checked={a.done} onChange={() => onToggle(a)} aria-label={`Done: ${a.text}`} />
        <span className="action-text">{a.text}</span>
      </label>
      <span className="action-meta">
        <AssigneeChip name={a.assignee} people={people} label={a.text} onAssign={onAssign && !a.done ? (who) => onAssign(a, who) : undefined} />
        {children}
      </span>
      {(onEdit || onRemove) && (
        <span className="row-tools">
          {onEdit && (
            <button type="button" className="icon-btn" aria-label={`Edit ${a.text}`} onClick={() => setDraft(a.text)}>
              <Icon name="pen" size={14} />
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon-btn danger" aria-label={`Remove ${a.text}`} onClick={() => onRemove(a)}>
              <Trash size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** The same items by who has them: a section per person in their colour, no one's last; each item names its call. */
function ByPerson({ groups, people, ...handlers }: { groups: Group[]; people: readonly Assignable[] } & Handlers) {
  const byPerson = useMemo(() => {
    const out: { name: string; items: { action: ActionView; meeting: Group["meeting"] }[] }[] = [];
    for (const g of groups) {
      for (const a of g.items) {
        const name = a.assignee.trim();
        let row = out.find((r) => sameName(r.name, name));
        if (!row) out.push((row = { name, items: [] }));
        row.items.push({ action: a, meeting: g.meeting });
      }
    }
    return out.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || b.items.length - a.items.length || a.name.localeCompare(b.name));
  }, [groups]);
  return (
    <>
      {byPerson.map((p) => (
        <details className="card oa-group" key={p.name || "-"} open data-testid="open-action-person">
          <summary className="oa-summary">
            <Icon name="right" size={14} />
            {p.name ? (
              <span className="who-avatar oa-person" style={{ "--who": assigneeColor(p.name, people) } as CSSProperties} aria-hidden="true">
                {assigneeInitials(p.name)}
              </span>
            ) : (
              <span className="oa-person none" aria-hidden="true">
                <Icon name="user" size={14} />
              </span>
            )}
            <span className="oa-title">
              <h2>{p.name || "Not assigned yet"}</h2>
            </span>
            <span className="oa-count">{p.items.filter((i) => !i.action.done).length}</span>
          </summary>
          <ul className="action-list">
            {p.items.map(({ action: a, meeting }) => (
              <OpenRow key={a.id} action={a} people={people} {...handlers}>
                <button type="button" className="oa-call" onClick={() => handlers.onOpen(a.meetingId)} title="Open the call">
                  <Icon name="mic" size={12} /> {meeting?.title || "Meeting"}
                </button>
              </OpenRow>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}
