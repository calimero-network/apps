import { useEffect, useState } from "react";
import type { WatchView } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { timeLabel } from "./format";
import { describeWatch, isActive, watchState } from "./watches";

/**
 * The watches on a task ("merge #434 when it's green"): where each stands,
 * and Cancel on one still waiting. Your agent's runtime fires each one once,
 * even after the session that set it ended. `activeOnly` keeps to the ones
 * still waiting, for the task's card in the feed.
 */
export function WatchList({ feed, chain, activeOnly = false }: { feed: Feed; chain: string; activeOnly?: boolean }) {
  const [watches, setWatches] = useState<WatchView[]>([]);
  const { loadWatches, page } = feed;
  // `page` changes on every re-read, which follows every event on the feed.
  useEffect(() => {
    let live = true;
    if (!chain || !loadWatches) setWatches([]);
    else void loadWatches(chain).then((w) => live && setWatches(w), () => live && setWatches([]));
    return () => {
      live = false;
    };
  }, [loadWatches, chain, page]);

  const shown = activeOnly ? watches.filter(isActive) : watches.filter((w) => w.status !== "cancelled");
  if (shown.length === 0) return null;
  return (
    <ul className="watches" aria-label="Watches">
      {shown.map((w) => {
        const state = watchState(w);
        const detail = w.status === "watching" ? w.seen : w.note;
        return (
          <li key={w.id} className={`watch tone-${state.tone}`}>
            <span className={`pill pill-${state.tone}`}>{state.label}</span>
            <span className="watch-what">{describeWatch(w)}</span>
            {detail && (
              <span className="watch-seen">
                {detail}
                {w.status === "watching" && w.seen_at > 0 ? ` · ${timeLabel(w.seen_at)}` : ""}
              </span>
            )}
            {w.status === "watching" && feed.cancelWatch && (
              <button
                type="button"
                className="link small watch-cancel"
                disabled={feed.busy}
                aria-label={`Cancel: ${describeWatch(w)}`}
                onClick={() => void feed.cancelWatch?.(w.id)}
              >
                Cancel
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
