import { useState } from "react";
import { Trash } from "@calimero-network/mero-icons";
import type { ActionView } from "./minutesApi";
import type { Workspace } from "./useWorkspace";
import { PersonName } from "./names";
import { formatClock } from "./lib/transcript";
import { Icon } from "./ui";

/**
 * A meeting's action items: anyone in the workspace adds, ticks and edits
 * them; the author, the meeting's recorder or the workspace's owner removes
 * one (the contract says the same and refuses anyone else).
 */
export function ActionItems({
  workspace,
  meetingId,
  actions,
  me,
  recorder,
  isOwner,
  segmentStart,
}: {
  workspace: Pick<Workspace, "act">;
  meetingId: string;
  actions: ActionView[] | null;
  me: string;
  recorder: string;
  isOwner: boolean;
  /** Where a source segment starts, for the "from 3:05" link; `undefined` when not loaded. */
  segmentStart?: (seq: number) => number | undefined;
}) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    await run(async () => {
      await workspace.act((c) => c.addAction({ meetingId, text: body, assignee: assignee.trim(), sourceSeq: null }));
      setText("");
      setAssignee("");
    });
    setBusy(false);
  };

  const open = actions?.filter((a) => !a.done).length ?? 0;

  return (
    <section className="card actions-card" aria-labelledby="actions-title">
      <div className="card-head">
        <h2 id="actions-title">Action items</h2>
        {actions && <span className="pill">{open} open</span>}
      </div>
      {actions === null && <p className="empty">Loading…</p>}
      {actions && actions.length === 0 && (
        <p className="empty">None yet. Add one below, or turn a line of the transcript into one.</p>
      )}
      {actions && actions.length > 0 && (
        <ul className="action-list">
          {actions.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              canRemove={a.createdBy === me || recorder === me || isOwner}
              from={a.sourceSeq !== null ? segmentStart?.(a.sourceSeq) : undefined}
              onToggle={() => run(() => workspace.act((c) => c.setActionDone({ actionId: a.id, done: !a.done })))}
              onEdit={(t, who) => run(() => workspace.act((c) => c.editAction({ actionId: a.id, text: t, assignee: who })))}
              onRemove={() => run(() => workspace.act((c) => c.removeAction({ actionId: a.id })))}
            />
          ))}
        </ul>
      )}
      <form
        className="action-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          aria-label="New action item"
          placeholder="Add an action item"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          aria-label="Assignee"
          placeholder="Who (optional)"
          maxLength={100}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="assignee-input"
        />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
          <Icon name="plus" /> Add
        </button>
      </form>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ActionRow({
  action,
  canRemove,
  from,
  onToggle,
  onEdit,
  onRemove,
}: {
  action: ActionView;
  canRemove: boolean;
  from?: number;
  onToggle: () => void;
  onEdit: (text: string, assignee: string) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<{ text: string; assignee: string } | null>(null);

  if (draft) {
    return (
      <li className="action editing">
        <form
          className="action-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.text.trim()) return;
            void onEdit(draft.text.trim(), draft.assignee.trim()).then(() => setDraft(null));
          }}
        >
          <input
            aria-label="Action item text"
            autoFocus
            maxLength={500}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
          />
          <input
            aria-label="Action item assignee"
            maxLength={100}
            placeholder="Who"
            value={draft.assignee}
            onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
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
    <li className={action.done ? "action done" : "action"} data-testid="action-item">
      <label className="action-check">
        <input type="checkbox" checked={action.done} onChange={onToggle} aria-label={`Done: ${action.text}`} />
        <span className="action-text">{action.text}</span>
      </label>
      <span className="action-meta">
        {action.assignee && <span className="pill">{action.assignee}</span>}
        {from !== undefined && <span className="dim">from {formatClock(from)}</span>}
        <span className="dim">
          added by <PersonName account={action.createdBy} />
        </span>
      </span>
      <span className="row-tools">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Edit ${action.text}`}
          onClick={() => setDraft({ text: action.text, assignee: action.assignee })}
        >
          <Icon name="pen" size={14} />
        </button>
        {canRemove && (
          <button type="button" className="icon-btn danger" aria-label={`Remove ${action.text}`} onClick={onRemove}>
            <Trash size={14} aria-hidden="true" />
          </button>
        )}
      </span>
    </li>
  );
}
