// React glue for the Calimero Yjs provider: owns a per-doc `Y.Doc` +
// `CalimeroYjsProvider`, wires the transport to the docs facade (appendUpdate /
// getUpdates), seeds the doc from the log at mount, and pulls on every SSE
// event. The returned `ydoc` is handed to BlockNote's native collaboration.
// Mounted only when the collaboration feature flag is on.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDocs } from '@/hooks/useDocs';
import { CalimeroYjsProvider } from './CalimeroYjsProvider';

export interface UseCollabDocResult {
  /** The collaborative Y.Doc, or null until the doc is hydrated (or on error). */
  ydoc: Y.Doc | null;
  /** The provider (exposes `.awareness` for BlockNote). Null until ready. */
  provider: CalimeroYjsProvider | null;
  /** True once the initial log pull has completed (doc is hydrated). */
  ready: boolean;
  /**
   * Set when the INITIAL log pull rejected. The doc/provider are NOT exposed in
   * this state: an empty editable doc would let the user overwrite remote
   * content. The caller should render an error/retry surface.
   */
  loadError: Error | null;
  /** Re-attempt the initial hydration after a `loadError`. */
  retry: () => void;
}

/**
 * Build a collaborative Y.Doc for `docId` in `folderId`. Returns `{ ydoc,
 * provider, ready }`. Tears down (and re-creates) on docId / context change.
 */
export function useCollabDoc(
  folderId: string,
  docId: string,
): UseCollabDocResult {
  const docs = useDocs(folderId);
  const { contextId, appendUpdate, getUpdates } = docs;

  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<CalimeroYjsProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const providerRef = useRef<CalimeroYjsProvider | null>(null);
  // Bumped by retry() to re-run the build effect after a load failure.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((a) => a + 1);
  }, []);

  // Mirror the transport methods into a ref so the build effect can key only
  // on the stable ids (contextId / docId). `useDocs` returns fresh callback
  // identities each render; listing them as effect deps would tear down and
  // rebuild the whole Y.Doc on every parent re-render.
  const transportRef = useRef({ appendUpdate, getUpdates });
  transportRef.current = { appendUpdate, getUpdates };

  // Build/tear down the doc + provider when the docs context or doc id changes.
  useEffect(() => {
    if (!contextId) return;
    let cancelled = false;

    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, {
      appendDocUpdate: (update) => transportRef.current.appendUpdate(docId, update),
      getDocUpdates: () => transportRef.current.getUpdates(docId),
    });
    providerRef.current = prov;
    setReady(false);
    setLoadError(null);

    // Seed from the log BEFORE exposing the doc to React state. BlockNote binds
    // y-prosemirror as soon as it sees the `ydoc`; gating exposure on the
    // initial pull means it only ever sees the already-hydrated doc (no flash of
    // empty content swapped out underneath it).
    void prov
      .pullRemote()
      .then(() => {
        if (cancelled) return;
        setYdoc(doc);
        setProvider(prov);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Hydration pull failed: leave ydoc/provider null (an editable empty doc
        // would overwrite remote content) and surface an error for retry.
        // Destroy the never-exposed provider + doc so we don't leak its
        // `doc.on('update')` listener / Awareness while the error UI is shown
        // (retry() builds a fresh pair). Effect cleanup also destroys on
        // unmount; this just frees it eagerly on the dead-end path.
        providerRef.current = null;
        void prov.destroy().catch(() => {}).finally(() => doc.destroy());
        console.warn('[useCollabDoc] initial pull failed', e);
        setLoadError(e instanceof Error ? e : new Error(String(e)));
      });

    return () => {
      cancelled = true;
      providerRef.current = null;
      setYdoc(null);
      setProvider(null);
      setReady(false);
      // Teardown-vs-rapid-retry safety: a retry() (or docId change) may run
      // while this effect's initial pull is still in flight. `destroy()` sets
      // `destroyed` synchronously and `pullRemote()` re-checks it after its
      // await (no await before `Y.applyUpdate`), so a stale pull bails before
      // touching the doc; `cancelled` gates the .then() that exposes it.
      //
      // Teardown is async (provider flushes + awaits any in-flight flush so a
      // close mid-typing doesn't drop keystrokes); React cleanup can't be async,
      // so we order it in a detached chain: destroy() then doc.destroy().
      void prov
        .destroy()
        .catch((e) =>
          console.warn('[useCollabDoc] provider teardown flush failed', e),
        )
        .finally(() => {
          doc.destroy();
        });
    };
    // `attempt` re-runs the build after retry().
  }, [contextId, docId, attempt]);

  // Pull on every SSE event — this is how a peer's appended updates reach us;
  // provider dedupe makes repeats free. Stable handler identity (ref-held) so
  // the subscription doesn't churn.
  const onEvent = useRef(() => {
    // Log a rejected pull rather than leak an unhandled rejection; the next SSE
    // event retries.
    void providerRef.current
      ?.pullRemote()
      .catch((e) => console.warn('[useCollabDoc] remote pull failed', e));
  }).current;
  useContextEvents(contextId, onEvent);

  return { ydoc, provider, ready, loadError, retry };
}
