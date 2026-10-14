import { useEffect, useRef, useState, type RefObject } from "react";
import type { PrView, WatchView } from "./generated/HyperfeedClient";
import { timeLabel } from "./format";
import {
  findRefs,
  lastRead,
  mergeOffer,
  pickPr,
  prKey,
  readPr,
  readRun,
  Unavailable,
  type Checks,
  type MergeOffer,
  type PullRequest,
  type Ref,
  type Run,
} from "./github";
import { mergeWatchFor } from "./watches";

/**
 * Cards for the GitHub pull requests and Actions runs a chat message links
 * to: what each is and where it stands, kept fresh while it is on screen.
 *
 * A PR card reads GitHub itself where it can (public repos, without a token),
 * and what your agent's runtime recorded in the feed (`record_pr`), which it
 * reads with your login: the newer of the two shows. Its Merge is a merge
 * watch on the task (`pr_green` → `merge`): the runtime merges once every
 * check passed and the base is the default branch, and the card shows how
 * that goes. Nothing is merged from the browser. A feed without watches asks
 * your agent in the chat instead ("merge PR <url>"). Until there is anything
 * to show, there is no card: the link in the message stands on its own.
 */
export function RefCards({ text, busy, onSend, merge }: { text: string; busy: boolean; onSend: (request: string) => void; merge?: MergeContext }) {
  const refs = findRefs(text);
  if (refs.length === 0) return null;
  // A message that is itself a merge request shows the cards without asking again.
  const actions = !/^\s*(merge|retarget) PR /i.test(text);
  return (
    <div className="ref-cards">
      {refs.map((r) =>
        r.kind === "pr" ? <PrCard key={r.url} ref_={r} busy={busy} actions={actions} onSend={onSend} merge={merge} /> : <RunCard key={r.url} ref_={r} />,
      )}
    </div>
  );
}

/** What a chat gives its PR cards: the task's watches, the runtime's PR records, and the merge button's actions. */
export interface MergeContext {
  /** The watches in this chat's chain. */
  watches: WatchView[];
  /** The runtime's PR records, by {@link prKey}. */
  seen: ReadonlyMap<string, PrView>;
  /** Merge, or Merge when green: a merge watch on this chain. Missing on a feed without watches. */
  onMerge?: (repo: string, pr: number) => void;
  onCancel?: (watchId: string) => void;
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
 * visible; `every` returning 0 stops (a merged PR, a finished run). `at` is
 * when it was last read (0 for an answer from before this card).
 */
function useLive<T>(url: string, read: (force: boolean) => Promise<T>, every: (data: T) => number, visible: boolean) {
  const [data, setData] = useState<T | undefined>(() => lastRead<T>(url));
  const [at, setAt] = useState(0);
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
        setAt(Date.now());
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

  return { data, at, error };
}

function checksLine(c: Checks): string {
  if (c.state === "red") return `Checks failed: ${c.failing.join(", ")}`;
  if (c.state === "pending") return c.total === 0 ? "Waiting for checks" : `Checks running: ${c.pending} of ${c.total} left`;
  return `Checks passed (${c.passed})`;
}

const STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

function PrCard({
  ref_,
  busy,
  actions,
  onSend,
  merge,
}: {
  ref_: Extract<Ref, { kind: "pr" }>;
  busy: boolean;
  actions: boolean;
  onSend: (request: string) => void;
  merge?: MergeContext;
}) {
  const el = useRef<HTMLDivElement>(null);
  const visible = useVisible(el);
  const { data: read, at, error } = useLive<PullRequest>(
    ref_.url,
    (force) => readPr(ref_, fetch, Date.now(), force),
    (p) => (p.state !== "open" ? 0 : p.checks.state === "pending" ? REFRESH_RUNNING_MS : REFRESH_SETTLED_MS),
    visible,
  );
  const seen = merge?.seen.get(prKey(`${ref_.owner}/${ref_.repo}`, ref_.number));
  const shown = pickPr(read, at, seen);
  const [asked, setAsked] = useState<string | null>(null);
  const label = `${ref_.owner}/${ref_.repo}#${ref_.number}`;
  const pr = shown?.pr;
  const watch = pr && merge ? mergeWatchFor(merge.watches, pr.repo, pr.number) : undefined;

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
          {actions && (
            <MergeControl
              pr={pr}
              watch={watch}
              busy={busy}
              asked={asked}
              onAsk={(r) => (setAsked(r), onSend(r))}
              onMerge={merge?.onMerge ? () => merge.onMerge?.(pr.repo, pr.number) : undefined}
              onCancel={merge?.onCancel}
            />
          )}
          {shown?.from === "feed" && seen ? (
            <span className="ref-stale">As your agent saw it on GitHub, {timeLabel(seen.seen_at)}</span>
          ) : (
            error && <span className="ref-stale">Couldn't refresh: {error.message}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Where a merge watch on this PR stands, in words for the card. */
function watchLine(w: WatchView, offer: MergeOffer): string {
  if (w.status === "firing") return "Merging…";
  if (w.status === "done") return w.note ? `Merged by your agent: ${w.note}` : "Merged by your agent";
  if (w.status === "failed") return w.note ? `Not merged: ${w.note}` : "Not merged";
  const when = offer.kind === "merge" ? "Merging on your agent's next look" : "Merges when every check passes";
  return w.seen ? `${when} · last seen: ${w.seen}` : when;
}

function MergeControl({
  pr,
  watch,
  busy,
  asked,
  onAsk,
  onMerge,
  onCancel,
}: {
  pr: PullRequest;
  watch: WatchView | undefined;
  busy: boolean;
  asked: string | null;
  onAsk: (request: string) => void;
  onMerge?: () => void;
  onCancel?: (watchId: string) => void;
}) {
  const offer = mergeOffer(pr);
  // A merge watch already set: where it stands, with Cancel while it waits.
  if (watch && (watch.status === "watching" || watch.status === "firing" || (watch.status === "done" && pr.state === "open"))) {
    return (
      <div className="ref-actions" role="status" aria-label="Merge">
        <span className={`pill pill-${watch.status === "done" ? "good" : "busy"}`}>{watch.status === "watching" ? "Merge when green" : watch.status === "firing" ? "Merging" : "Merged"}</span>
        <span className="ref-why">{watchLine(watch, offer)}</span>
        {watch.status === "watching" && onCancel && (
          <button type="button" className="link small" disabled={busy} onClick={() => onCancel(watch.id)}>
            Cancel
          </button>
        )}
      </div>
    );
  }
  // The runtime refused or failed the last one: why, then the button again.
  const refused = watch?.status === "failed" && pr.state === "open" ? <span className="ref-why ref-refused">{watchLine(watch, offer)}</span> : null;
  if (offer.kind === "none") return null;
  if (offer.kind === "stacked") {
    return (
      <div className="ref-actions">
        <span className="ref-why ref-stacked">{offer.why}</span>
      </div>
    );
  }
  if (offer.kind === "blocked") {
    return (
      <div className="ref-actions">
        <button type="button" className="small" disabled title={offer.why}>
          {offer.label}
        </button>
        <span className="ref-why">{offer.why}</span>
        {refused}
      </div>
    );
  }
  const label = offer.kind === "merge" ? "Merge" : offer.kind === "when-green" ? "Merge when green" : offer.label;
  // Merge and Merge when green set the watch; retargeting is asked of your agent in the chat.
  const viaWatch = offer.kind !== "retarget" && onMerge;
  const sent = !viaWatch && asked === offer.request;
  return (
    <div className="ref-actions">
      <button
        type="button"
        className={`small${offer.kind === "merge" ? " primary" : ""}`}
        disabled={busy || sent}
        onClick={() => (viaWatch ? onMerge() : onAsk(offer.request))}
      >
        {label}
      </button>
      {sent && <span className="ref-why">Asked your agent</span>}
      {refused}
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
