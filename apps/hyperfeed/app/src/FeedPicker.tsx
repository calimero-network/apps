import { useCallback, useEffect, useRef, useState } from "react";
import { useApplicationContexts, useMero } from "@calimero-network/mero-react";
import { short } from "./format";
import { openFeed, useNewFeed } from "./newFeed";
import { HyperfeedClient } from "./generated/HyperfeedClient";
import { confirmText, deleteFeed, factsLine, isEmpty, orderFeeds, type FeedAdmin, type FeedFacts } from "./feeds";

/** Your feeds on this node: only this Hyperfeed's, never another app's contexts. */
function useFeeds(applicationId: string | null) {
  const { contexts: reported, loading, error, refetch } = useApplicationContexts(applicationId);
  // Without an application id the hook lists EVERY context on the node; only
  // ours are safe to open.
  const contexts = applicationId ? reported.filter((c) => c.applicationId === applicationId) : [];
  return { contexts, loading, error, refetch };
}

/** How much each feed holds and when it last moved, read while the switcher is open. */
function useFeedFacts(ids: string[], open: boolean) {
  const { mero } = useMero();
  const [facts, setFacts] = useState<Record<string, FeedFacts>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!open || !mero) return;
    let live = true;
    for (const id of key.split(",").filter(Boolean)) {
      new HyperfeedClient(mero, id)
        .feed({ filter: "all", app_key: "", limit: 1, before: 0 })
        .then(
          (p) => ({ rows: p.counts.all + p.counts.archived, at: p.items[0]?.chain_at ?? 0 }),
          () => ({ rows: null, at: 0 }),
        )
        .then((f) => live && setFacts((all) => ({ ...all, [id]: f })));
    }
    return () => {
      live = false;
    };
  }, [open, mero, key]);
  return facts;
}

/**
 * Delete a feed you are not in, with its namespace. Mero-bot and the
 * collector stop on their own: they follow the contexts the node lists.
 */
function useDeleteFeed(onDeleted: () => void) {
  const { admin } = useMero();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const remove = useCallback(
    async (id: string) => {
      if (!admin) return;
      setBusy(id);
      setFailed(null);
      try {
        await deleteFeed(admin as unknown as FeedAdmin, id);
        onDeleted();
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [admin, onDeleted],
  );
  return { remove, busy, failed, ready: Boolean(admin) };
}

/**
 * The open feed's name in the header, and every other feed one click away:
 * switching keeps you signed in and opens the feed in place. Each feed says
 * how much it holds, and any but the open one can be deleted, after a
 * confirm that names what goes.
 */
export function FeedSwitcher({ applicationId, current }: { applicationId: string | null; current: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { contexts, loading, refetch } = useFeeds(applicationId);
  const { create, busy, failed } = useNewFeed(applicationId);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refetch();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
    // refetch changes identity per render; fetch once per opening.
  }, [open]);

  // The open feed is listed even before the node reports it.
  const listed = contexts.some((c) => c.contextId === current) ? contexts.map((c) => c.contextId) : [current, ...contexts.map((c) => c.contextId)];
  const facts = useFeedFacts(listed, open);
  const ids = orderFeeds(listed, current, facts);
  const onDeleted = useCallback(() => {
    setConfirming(null);
    void refetch();
  }, [refetch]);
  const del = useDeleteFeed(onDeleted);

  return (
    <div className="switcher" ref={root}>
      <button
        type="button"
        className="switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch feed"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mono">{short(current)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="switcher-menu" role="menu" aria-label="Your feeds">
          <div className="switcher-label">Your feeds{loading ? " · looking…" : ""}</div>
          {ids.map((id) =>
            confirming === id ? (
              <div key={id} className="switcher-confirm" role="alertdialog" aria-label={`Delete feed ${short(id)}`}>
                <p>{confirmText(facts[id])}</p>
                <div className="row">
                  <button type="button" className="danger small" disabled={del.busy !== null} onClick={() => void del.remove(id)}>
                    {del.busy === id ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" className="ghost small" disabled={del.busy !== null} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={id} className={`switcher-feed ${isEmpty(facts[id]) ? "empty" : ""}`}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={id === current}
                  className={id === current ? "on" : ""}
                  onClick={() => {
                    setOpen(false);
                    if (id !== current) openFeed(id);
                  }}
                >
                  <span className="switcher-id">
                    <span className="mono">{short(id)}</span>
                    <span className="switcher-facts">{factsLine(facts[id])}</span>
                  </span>
                  {id === current && <span className="switcher-check">Open</span>}
                </button>
                {id !== current && del.ready && (
                  <button type="button" role="menuitem" className="switcher-delete" aria-label={`Delete feed ${short(id)}`} title="Delete this feed" onClick={() => setConfirming(id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                    </svg>
                  </button>
                )}
              </div>
            ),
          )}
          {del.failed && <pre className="err">{del.failed}</pre>}
          <hr />
          <button type="button" role="menuitem" disabled={busy || !applicationId} onClick={() => void create()}>
            {busy ? "Creating…" : "Create a new feed"}
          </button>
          {failed && <pre className="err">{failed}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * Open your feed, or make it.
 *
 * Under `AppMode.MultiContext` the session carries no context, so picking one
 * is the app's job. A feed is personal: usually there is exactly one, in a
 * namespace of its own that you never invite anyone to.
 */
export function FeedPicker({ applicationId }: { applicationId: string | null }) {
  const { contexts, loading, error, refetch } = useFeeds(applicationId);
  const { create, busy, failed } = useNewFeed(applicationId);

  return (
    <section className="center-card">
      <h1>Your feed</h1>
      <p className="muted">
        A feed is a context only you write to. Your agent records what it does there, and this app records
        what your other apps send you.
      </p>
      {loading && <p className="muted">Looking for your feed…</p>}
      {error && <pre className="err">{error.message}</pre>}
      {!loading && !applicationId && (
        <p className="muted">
          Waiting for the session to say which application it is bound to. If it never does, install Hyperfeed
          on the node first.
        </p>
      )}
      {contexts.length > 0 && (
        <ul className="picker">
          {contexts.map((c) => (
            <li key={c.contextId}>
              <button type="button" className="ghost" onClick={() => openFeed(c.contextId)}>
                Open feed <span className="mono">{short(c.contextId)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        {/* Always offered: a feed made by an earlier Hyperfeed is replaced by a new one. */}
        {!loading && applicationId && (
          <button type="button" className={contexts.length === 0 ? "primary" : "ghost"} disabled={busy} onClick={() => void create()}>
            {busy ? "Creating…" : contexts.length === 0 ? "Create my feed" : "Create a new feed"}
          </button>
        )}
        <button type="button" className="ghost" disabled={loading} onClick={() => void refetch()}>
          Refresh
        </button>
      </div>
      {failed && <pre className="err">{failed}</pre>}
    </section>
  );
}
