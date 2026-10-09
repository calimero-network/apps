import { useApplicationContexts } from "@calimero-network/mero-react";
import { short } from "./format";
import { openFeed, useNewFeed } from "./newFeed";

/**
 * Open your feed, or make it.
 *
 * Under `AppMode.MultiContext` the session carries no context, so picking one
 * is the app's job. A feed is personal: usually there is exactly one, in a
 * namespace of its own that you never invite anyone to.
 */
export function FeedPicker({ applicationId }: { applicationId: string | null }) {
  const { contexts: reported, loading, error, refetch } = useApplicationContexts(applicationId);
  // Without an application id the hook lists EVERY context on the node; only
  // ours are safe to open.
  const contexts = applicationId ? reported.filter((c) => c.applicationId === applicationId) : [];
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
