import { useEffect, useRef, useState, type RefObject } from "react";
import {
  findRefs,
  lastRead,
  mergeOffer,
  readPr,
  readRun,
  Unavailable,
  type Checks,
  type PullRequest,
  type Ref,
  type Run,
} from "./github";

/**
 * Cards for the GitHub pull requests and Actions runs a chat message links
 * to: what each is and where it stands, kept fresh while it is on screen.
 *
 * A PR card's Merge asks your agent in the chat ("merge PR <url>"); nothing
 * is merged from the browser. Until GitHub answers, or when it can't be read
 * (a rate limit, a private repo), there is no card: the link in the message,
 * which the bubble's markdown makes clickable, stands on its own.
 */
export function RefCards({ text, busy, onSend }: { text: string; busy: boolean; onSend: (request: string) => void }) {
  const refs = findRefs(text);
  if (refs.length === 0) return null;
  // A message that is itself a merge request shows the cards without asking again.
  const actions = !/^\s*(merge|retarget) PR /i.test(text);
  return (
    <div className="ref-cards">
      {refs.map((r) => (r.kind === "pr" ? <PrCard key={r.url} ref_={r} busy={busy} actions={actions} onSend={onSend} /> : <RunCard key={r.url} ref_={r} />))}
    </div>
  );
}

/** How often an open PR is read again while its checks run, and once they have finished. */
export const REFRESH_RUNNING_MS = 60_000;
export const REFRESH_SETTLED_MS = 3 * 60_000;

/** Whether an element is on screen in a tab you're looking at. */
function useVisible(el: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)));
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    const on = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return inView && shown;
}

/**
 * Reads a card's data, then again every `every(data)` ms while it is
 * visible; `every` returning 0 stops (a merged PR, a finished run).
 */
function useLive<T>(url: string, read: (force: boolean) => Promise<T>, every: (data: T) => number, visible: boolean) {
  const [data, setData] = useState<T | undefined>(() => lastRead<T>(url));
  const [error, setError] = useState<Unavailable | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    readRef.current(tick > 0).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (e: unknown) => live && setError(e instanceof Unavailable ? e : new Unavailable("failed")),
    );
    return () => {
      live = false;
    };
  }, [url, tick]);

  const wait = data === undefined ? 0 : every(data);
  useEffect(() => {
    if (!visible || !wait) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [visible, wait, tick]);

  return { data, error };
}

function checksLine(c: Checks): string {
  if (c.state === "red") return `Checks failed: ${c.failing.join(", ")}`;
  if (c.state === "pending") return c.total === 0 ? "Waiting for checks" : `Checks running: ${c.pending} of ${c.total} left`;
  return `Checks passed (${c.passed})`;
}

const STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

function PrCard({ ref_, busy, actions, onSend }: { ref_: Extract<Ref, { kind: "pr" }>; busy: boolean; actions: boolean; onSend: (request: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const visible = useVisible(el);
  const { data: pr, error } = useLive<PullRequest>(
    ref_.url,
    (force) => readPr(ref_, fetch, Date.now(), force),
    (p) => (p.state !== "open" ? 0 : p.checks.state === "pending" ? REFRESH_RUNNING_MS : REFRESH_SETTLED_MS),
    visible,
  );
  const [asked, setAsked] = useState<string | null>(null);
  const label = `${ref_.owner}/${ref_.repo}#${ref_.number}`;

  return (
    <div ref={el} className="ref-card-slot">
      {pr && (
        <div className={`ref-card pr-card state-${pr.state}`} role="group" aria-label={`Pull request ${label}`}>
          <a className="ref-card-title" href={pr.url} target="_blank" rel="noopener noreferrer">
            {pr.title}
          </a>
          <div className="ref-card-meta">
            <span className={`ref-state ${pr.state}`}>{pr.draft && pr.state === "open" ? "Draft" : STATE_LABEL[pr.state]}</span>
            <span>
              {pr.repo}#{pr.number}
            </span>
            <span>
              into <code>{pr.base}</code>
            </span>
          </div>
          {pr.state === "open" && <div className={`ref-checks ${pr.checks.state}`}>{checksLine(pr.checks)}</div>}
          {actions && <MergeControl pr={pr} busy={busy} asked={asked} onAsk={(r) => (setAsked(r), onSend(r))} />}
          {error && <span className="ref-stale">Couldn't refresh: {error.message}</span>}
        </div>
      )}
    </div>
  );
}

function MergeControl({ pr, busy, asked, onAsk }: { pr: PullRequest; busy: boolean; asked: string | null; onAsk: (request: string) => void }) {
  const offer = mergeOffer(pr);
  if (offer.kind === "none") return null;
  if (offer.kind === "blocked") {
    return (
      <div className="ref-actions">
        <button type="button" className="small" disabled title={offer.why}>
          {offer.label}
        </button>
        <span className="ref-why">{offer.why}</span>
      </div>
    );
  }
  const label = offer.kind === "merge" ? "Merge" : offer.kind === "when-green" ? "Merge when green" : offer.label;
  const sent = asked === offer.request;
  return (
    <div className="ref-actions">
      <button type="button" className={`small${offer.kind === "merge" ? " primary" : ""}`} disabled={busy || sent} onClick={() => onAsk(offer.request)}>
        {label}
      </button>
      {sent && <span className="ref-why">Asked your agent</span>}
    </div>
  );
}

const RUN_LABEL = { green: "Passed", red: "Failed", pending: "Running" } as const;

function RunCard({ ref_ }: { ref_: Extract<Ref, { kind: "run" }> }) {
  const el = useRef<HTMLDivElement>(null);
  const visible = useVisible(el);
  const { data: run, error } = useLive<Run>(
    ref_.url,
    (force) => readRun(ref_, fetch, Date.now(), force),
    (r) => (r.state === "pending" ? REFRESH_RUNNING_MS : 0),
    visible,
  );
  const label = `${ref_.owner}/${ref_.repo} run ${ref_.id}`;
  return (
    <div ref={el} className="ref-card-slot">
      {run && (
        <div className="ref-card run-card" role="group" aria-label={`Actions run ${label}`}>
          <a className="ref-card-title" href={run.url} target="_blank" rel="noopener noreferrer">
            {run.name}: {run.title}
          </a>
          <div className="ref-card-meta">
            <span>{run.repo}</span>
            <span>
              on <code>{run.branch}</code>
            </span>
          </div>
          <div className={`ref-checks ${run.state}`}>
            {RUN_LABEL[run.state]}
            {run.state === "red" && run.failing.length > 0 ? `: ${run.failing.join(", ")}` : run.state === "red" && run.result !== "failure" ? ` (${run.result})` : ""}
          </div>
          {error && <span className="ref-stale">Couldn't refresh: {error.message}</span>}
        </div>
      )}
    </div>
  );
}
