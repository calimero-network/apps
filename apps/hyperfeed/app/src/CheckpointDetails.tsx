import { safeHref } from "./markdown";
import { checkpointByline, checkpointSections, prHref, type CheckpointView } from "./checkpoint";

/**
 * Where a task stands, behind a disclosure on the task: what your agent has
 * done, its next step, open questions, PRs, branches and worktrees, and who
 * wrote it when. Closed by default; the task's pill says the short of it.
 */
export function CheckpointDetails({ checkpoint, now = Date.now() }: { checkpoint: CheckpointView; now?: number }) {
  const sections = checkpointSections(checkpoint);
  if (sections.length === 0) return null;
  return (
    <details className="checkpoint">
      <summary>Where it stands</summary>
      <dl className="checkpoint-body">
        {sections.map((s) => (
          <div key={s.label} className="checkpoint-section">
            <dt>{s.label}</dt>
            {s.lines.map((l, i) => (
              <dd key={i}>{s.label === "PRs" ? <PrLink entry={l} /> : s.label === "Branches" || s.label === "Worktrees" ? <code>{l}</code> : l}</dd>
            ))}
          </div>
        ))}
      </dl>
      <p className="checkpoint-by">{checkpointByline(checkpoint, now)}</p>
    </details>
  );
}

function PrLink({ entry }: { entry: string }) {
  const href = prHref(entry);
  const safe = href ? safeHref(href) : null;
  if (!safe) return <>{entry}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {entry}
    </a>
  );
}
