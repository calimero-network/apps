import { useEffect, useRef, useState, type CSSProperties } from "react";
import { assigneeColor, assigneeInitials, sameName, type Assignable } from "./lib/assignee";
import { useOrg } from "./names";
import { Icon } from "./ui";

/** Workspace members' names (the names they set for the organization). */
export function useMemberNames(): string[] {
  const { members } = useOrg();
  return members ? [...members.names.values()] : [];
}

/** Who an action item is for, in their colour; "Assign" when no one. A button when it can be changed. */
export function AssigneeChip({
  name,
  people = [],
  onAssign,
  label,
}: {
  name: string;
  people?: readonly Assignable[];
  /** Absent: the chip only shows. */
  onAssign?: (name: string) => void;
  /** What the action is, for the button's name. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const who = name.trim();
  const style = who ? ({ "--who": assigneeColor(who, people) } as CSSProperties) : undefined;
  const body = (
    <>
      {who ? (
        <span className="who-avatar" aria-hidden="true">
          {assigneeInitials(who)}
        </span>
      ) : (
        <Icon name="user" size={12} />
      )}
      <span className="who-name">{who || "Assign"}</span>
    </>
  );
  if (!onAssign) {
    return who ? (
      <span className="who-chip" style={style} data-testid="assignee">
        {body}
      </span>
    ) : null;
  }
  return (
    <span className="who-wrap" ref={ref}>
      <button
        type="button"
        className={who ? "who-chip" : "who-chip empty"}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={who ? `Assigned to ${who}${label ? `: ${label}` : ""}. Change` : `Assign${label ? ` ${label}` : ""}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="assignee"
      >
        {body}
      </button>
      {open && (
        <AssigneePicker
          current={who}
          people={people}
          onPick={(n) => {
            setOpen(false);
            if (!sameName(n, who) || (n === "" && who !== "")) onAssign(n);
          }}
        />
      )}
    </span>
  );
}

/** The list to pick from: the call's speakers, the workspace's members, anyone typed, or no one. */
export function AssigneePicker({
  current,
  people,
  onPick,
}: {
  current: string;
  people: readonly Assignable[];
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const typedIsNew = q && !people.some((p) => sameName(p.name, q));
  return (
    <div className="who-picker glass-float" role="listbox" aria-label="Assign to">
      <input
        autoFocus
        className="who-search"
        placeholder="Name or search…"
        maxLength={100}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (q) onPick(shown.length === 1 && !typedIsNew ? shown[0]!.name : q);
          }
        }}
        aria-label="Assignee name"
      />
      <div className="who-options">
        {typedIsNew && (
          <button type="button" role="option" aria-selected={false} className="who-option" onClick={() => onPick(q)}>
            <span className="who-avatar" style={{ "--who": assigneeColor(q, people) } as CSSProperties} aria-hidden="true">
              {assigneeInitials(q)}
            </span>
            <span className="who-option-name">Assign to “{q}”</span>
          </button>
        )}
        {shown.map((p) => (
          <button
            key={p.name}
            type="button"
            role="option"
            aria-selected={sameName(p.name, current)}
            className="who-option"
            onClick={() => onPick(p.name)}
          >
            <span className="who-avatar" style={{ "--who": p.color } as CSSProperties} aria-hidden="true">
              {assigneeInitials(p.name)}
            </span>
            <span className="who-option-name">{p.name}</span>
            <span className="dim who-source">{p.source === "speaker" ? "in this call" : "member"}</span>
            {sameName(p.name, current) && <Icon name="check" size={14} />}
          </button>
        ))}
        {current && (
          <button type="button" role="option" aria-selected={false} className="who-option clear" onClick={() => onPick("")}>
            <Icon name="x" size={14} />
            <span className="who-option-name">Unassign</span>
          </button>
        )}
      </div>
    </div>
  );
}
