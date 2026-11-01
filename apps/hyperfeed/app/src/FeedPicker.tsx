import { useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { feedSource, openFeed, signedIn, useNewFeed } from "./newFeed";
import { calimeroTransport, HyperfeedClient } from "./hyperfeed";
import { useSessionApi } from "./session";
import {
  confirmText,
  deleteFeed,
  factsLine,
  feedLabel,
  hint,
  isEmpty,
  listFeeds,
  NAME_MAX,
  nameProblem,
  orderFeeds,
  readFeedNames,
  renameFeed,
  suggestName,
  type FeedFacts,
} from "./feeds";

/** The signed-in client, or null. */
function useClient() {
  const { session } = useSessionApi();
  return signedIn(session)?.client ?? null;
}

/** Your feeds on the cluster: instances of this Hyperfeed, never another app's. */
function useFeeds() {
  const client = useClient();
  const [feeds, setFeeds] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!client) return;
    let live = true;
    setLoading(true);
    listFeeds(client, feedSource())
      .then(
        (f) => live && (setFeeds(f), setError(null)),
        (e: unknown) => live && setError(describeError(e)),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, asked]);
  const refetch = useCallback(async () => setAsked((n) => n + 1), []);
  return { feeds, loading, error, refetch };
}

/** How much each feed holds and when it last moved, read while the switcher is open. */
function useFeedFacts(ids: string[], open: boolean) {
  const client = useClient();
  const [facts, setFacts] = useState<Record<string, FeedFacts>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!open || !client) return;
    let live = true;
    for (const id of key.split(",").filter(Boolean)) {
      new HyperfeedClient(calimeroTransport(client), id)
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
  }, [open, client, key]);
  return facts;
}

/** Every feed's name: read whenever the list or `tick` moves. */
function useFeedNames(feeds: AppInfo[], tick: unknown) {
  const client = useClient();
  const [names, setNames] = useState<Record<string, string | null> | null>(null);
  const [again, setAgain] = useState(0);
  const key = feeds.map((f) => `${f.appId}:${f.name}`).join(",");
  useEffect(() => {
    if (!client) return;
    let live = true;
    readFeedNames(client, feeds).then(
      (n) => live && setNames(n),
      () => live && setNames((n) => n ?? {}),
    );
    return () => {
      live = false;
    };
    // `key` stands for `feeds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, tick, again]);
  const reread = useCallback(() => setAgain((a) => a + 1), []);
  return { names, reread, client };
}

/** A feed's name, then its short id as a hint; just the id while names are read. */
function FeedTitle({ id, names }: { id: string; names: Record<string, string | null> | null }) {
  if (!names) return <span className="mono">{hint(id)}</span>;
  return (
    <>
      <span className={`switcher-name ${names[id] ? "" : "unnamed"}`}>{names[id] || "Unnamed feed"}</span>
      <span className="mono switcher-hint"> · {hint(id)}</span>
    </>
  );
}

/** A name to type, checked as you type: for a new feed, or a rename. */
function NameForm({
  label,
  initial,
  submit,
  busyText,
  busy,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submit: string;
  busyText: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial);
  const problem = nameProblem(name);
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !busy) onSubmit(name.trim());
      }}
    >
      <label>
        <span>{label}</span>
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX}
          required
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Escape cancels the name, not the whole menu.
            if (e.key === "Escape" && onCancel) {
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      </label>
      {problem && name !== initial && <span className="name-problem">{problem}</span>}
      <div className="row">
        <button type="submit" className="primary small" disabled={Boolean(problem) || busy}>
          {busy ? busyText : submit}
        </button>
        {onCancel && (
          <button type="button" className="ghost small" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Delete a feed you are not in. Mero-bot and the collector stop on their own:
 * they follow the apps the cluster lists.
 */
function useDeleteFeed(onDeleted: () => void) {
  const client = useClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const remove = useCallback(
    async (id: string) => {
      if (!client) return;
      setBusy(id);
      setFailed(null);
      try {
        await deleteFeed(client, id);
        onDeleted();
      } catch (e) {
        setFailed(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [client, onDeleted],
  );
  return { remove, busy, failed, ready: Boolean(client) };
}

/**
 * The open feed's name in the header, and every other feed one click away:
 * switching keeps you signed in and opens the feed in place. Each feed says
 * its name, with its short id as a hint, and how much it holds; any can be
 * renamed, and any but the open one deleted, after a confirm that names
 * what goes. A new feed is named as it is made.
 */
export function FeedSwitcher({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameFailed, setRenameFailed] = useState<string | null>(null);
  const { feeds, loading, refetch } = useFeeds();
  const { create, busy, failed, ready } = useNewFeed();
  const { names, reread, client } = useFeedNames(feeds, open);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    setNaming(false);
    setRenaming(null);
    setRenameFailed(null);
  }, [open]);

  const rename = async (id: string, name: string) => {
    if (!client) return;
    setRenameBusy(true);
    setRenameFailed(null);
    try {
      await renameFeed(client, id, name);
      setRenaming(null);
      reread();
    } catch (e) {
      setRenameFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setRenameBusy(false);
    }
  };

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
  const listed = feeds.some((f) => f.appId === current) ? feeds.map((f) => f.appId) : [current, ...feeds.map((f) => f.appId)];
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
        <FeedTitle id={current} names={names} />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="switcher-menu" role="menu" aria-label="Your feeds">
          <div className="switcher-label">Your feeds{loading ? " · looking…" : ""}</div>
          {ids.map((id) =>
            confirming === id ? (
              <div key={id} className="switcher-confirm" role="alertdialog" aria-label={`Delete feed ${feedLabel(names?.[id], id)}`}>
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
            ) : renaming === id ? (
              <div key={id} className="switcher-rename" role="group" aria-label={`Rename feed ${feedLabel(names?.[id], id)}`}>
                <NameForm
                  label="Name"
                  initial={names?.[id] ?? ""}
                  submit="Save"
                  busyText="Saving…"
                  busy={renameBusy}
                  onSubmit={(name) => void rename(id, name)}
                  onCancel={() => setRenaming(null)}
                />
                {renameFailed && <pre className="err">{renameFailed}</pre>}
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
                    <span className="switcher-title">
                      <FeedTitle id={id} names={names} />
                    </span>
                    <span className="switcher-facts">{factsLine(facts[id])}</span>
                  </span>
                  {id === current && <span className="switcher-check">Open</span>}
                </button>
                {names && client && (
                  <button
                    type="button"
                    role="menuitem"
                    className="switcher-delete switcher-rename-button"
                    aria-label={`Rename feed ${feedLabel(names[id], id)}`}
                    title="Rename this feed"
                    onClick={() => {
                      setRenameFailed(null);
                      setRenaming(id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                    </svg>
                  </button>
                )}
                {id !== current && del.ready && (
                  <button type="button" role="menuitem" className="switcher-delete" aria-label={`Delete feed ${feedLabel(names?.[id], id)}`} title="Delete this feed" onClick={() => setConfirming(id)}>
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
          {naming ? (
            <div className="switcher-rename" role="group" aria-label="Name your new feed">
              <NameForm
                label="Name"
                initial={suggestName(Object.values(names ?? {}))}
                submit="Create"
                busyText="Creating…"
                busy={busy}
                onSubmit={(name) =>
                  void create(name).then((made) => {
                    if (!made) return;
                    setNaming(false);
                    reread();
                  })
                }
                onCancel={() => setNaming(false)}
              />
            </div>
          ) : (
            <button type="button" role="menuitem" disabled={busy || !ready} onClick={() => setNaming(true)}>
              Create a new feed
            </button>
          )}
          {failed && <pre className="err">{failed}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * Open your feed, or make it.
 *
 * A feed is personal: usually there is exactly one, an app instance in an
 * organization of its own that only the cloud agents you add are invited to.
 */
export function FeedPicker() {
  const { feeds, loading, error, refetch } = useFeeds();
  const { create, busy, failed, ready } = useNewFeed();
  const { names } = useFeedNames(feeds, feeds.length);

  return (
    <section className="center-card">
      <h1>Your feed</h1>
      <p className="muted">
        A feed is an app only you write to. Your agent records what it does there, and this app records
        what your other apps send you.
      </p>
      {loading && <p className="muted">Looking for your feed…</p>}
      {error && <pre className="err">{error}</pre>}
      {feeds.length > 0 && (
        <ul className="picker">
          {feeds.map((f) => (
            <li key={f.appId}>
              <button type="button" className="ghost" onClick={() => openFeed(f.appId)}>
                Open feed <FeedTitle id={f.appId} names={names} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Always offered: a second feed, or one to replace an old one. */}
      {!loading && ready && (
        <NameForm
          // Remade once names are read, so the suggestion skips a taken one.
          key={names ? "named" : "reading"}
          label="Feed name"
          initial={suggestName(Object.values(names ?? {}))}
          submit={feeds.length === 0 ? "Create my feed" : "Create a new feed"}
          busyText="Creating…"
          busy={busy}
          onSubmit={(name) => void create(name)}
        />
      )}
      <div className="row">
        <button type="button" className="ghost" disabled={loading} onClick={() => void refetch()}>
          Refresh
        </button>
      </div>
      {failed && <pre className="err">{failed}</pre>}
    </section>
  );
}
