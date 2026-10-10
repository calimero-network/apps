import { useState, type ReactNode } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
  useNamespacesForApplication,
} from "@calimero-network/mero-react";
import { IconCube, IconPlus } from "./ui/icons";

/**
 * Choose which scene (context) to open, or make one.
 *
 * Under `AppMode.MultiContext` the auth callback hands back tokens and an
 * application id and nothing else, so picking a context is the app's job.
 * A context lives inside a NAMESPACE (there is no bare-context path since
 * rc.21), so the two steps are shown separately, with a one-click "New scene"
 * that does both for a fresh node.
 */

/** rc.25 renamed `groupId` -> `namespaceId`; read both. */
function namespaceIdOf(ns: unknown): string | undefined {
  const n = ns as { namespaceId?: string; groupId?: string; id?: string } | null;
  return n?.namespaceId ?? n?.groupId ?? n?.id;
}

/** `init(name)` — the contract's only init argument. */
function sceneInit(name: string): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify({ name: name.trim() || "Untitled scene" })));
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function ScenePicker({ applicationId, children }: { applicationId: string | null; children?: ReactNode }) {
  const { contexts: reported, loading, error, refetch } = useApplicationContexts(applicationId);
  // ⚠️ With no application id the hook falls back to EVERY context on the node,
  // other apps' included. "Cannot tell which are mine" is not "all are mine".
  const contexts = applicationId ? reported.filter((c) => c.applicationId === applicationId) : [];
  const { namespaces, loading: nsLoading, error: nsError, refetch: refetchNamespaces } = useNamespacesForApplication(applicationId);
  const { createNamespace } = useCreateNamespace();
  const { createContext } = useCreateContext();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function open(id: string) {
    setContextId(id);
    // The provider reads the stored context on mount; a reload adopts it.
    window.location.reload();
  }

  async function makeIn(namespaceId: string) {
    const ctx = await createContext({ applicationId: applicationId!, groupId: namespaceId, initializationParams: sceneInit(name) });
    const id = (ctx as { contextId?: string } | null)?.contextId;
    if (!id) throw new Error("context created but no contextId came back");
    open(id);
  }

  async function run(key: string, fn: () => Promise<void>) {
    if (!applicationId) return;
    setBusy(key);
    setFailed(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      // A bare 500 from `POST /contexts` means `init` refused its params;
      // core hides the reason, so at least show that it failed and where.
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const nsList = (namespaces ?? []) as unknown[];

  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div className="lobby-copy">
          <p className="eyebrow">Scenes</p>
          <h1>Model together, on your own nodes</h1>
          <p className="lede">
            A scene is one Calimero context. Every member&apos;s node holds the whole model, edits replicate peer to peer,
            and nothing is stored on a server.
          </p>
          <div className="new-scene">
            <input
              placeholder="Scene name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              aria-label="Scene name"
              onKeyDown={(e) => {
                if (e.key === "Enter") void createBoth();
              }}
            />
            <button className="large" onClick={() => void createBoth()} disabled={busy !== null || !applicationId} data-testid="new-scene">
              <IconPlus /> {busy === "both" ? "Creating…" : "New scene"}
            </button>
          </div>
          {note && <p className="hint">{note}</p>}
          {failed && <pre className="err">{failed}</pre>}
        </div>
        <div className="lobby-art" aria-hidden="true">
          <IconCube size={140} strokeWidth={0.6} />
        </div>
      </section>

      <div className="lobby-grid">
        <div className="card">
          <div className="card-head">
            <h2>Open a scene</h2>
            <button
              className="ghost small"
              onClick={() => {
                void refetch();
                void refetchNamespaces();
              }}
              disabled={loading || nsLoading}
            >
              Refresh
            </button>
          </div>
          {loading && <p className="empty">Loading scenes…</p>}
          {error && <pre className="err">{error.message}</pre>}
          {!loading && !applicationId && (
            <p className="empty">
              Waiting for this session to say which application it is bound to. If it never does, install Mero Models on
              the node first.
            </p>
          )}
          {!loading && applicationId && contexts.length === 0 && (
            <p className="empty">No scenes on this node yet. Start one above, or join one with an invitation.</p>
          )}
          {contexts.length > 0 && (
            <ul className="scene-list">
              {contexts.map((c, i) => (
                <li key={c.contextId}>
                  <button className="scene-item" onClick={() => open(c.contextId)} data-testid="scene-item">
                    <span className="scene-icon" aria-hidden="true">
                      <IconCube size={22} />
                    </span>
                    <span className="scene-text">
                      <span className="scene-title-row">Scene {i + 1}</span>
                      <span className="mono scene-id" title={c.contextId}>
                        {c.contextId}
                      </span>
                    </span>
                    <span className="scene-open">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lobby-side">
          {children}
          <div className="card">
            <div className="card-head">
              <h2>Namespaces</h2>
              <button
                className="ghost small"
                disabled={busy !== null || !applicationId}
                onClick={() =>
                  void run("namespace", async () => {
                    const ns = await createNamespace({ applicationId: applicationId! });
                    const id = namespaceIdOf(ns);
                    if (!id) throw new Error("namespace created but no id came back");
                    await refetchNamespaces();
                    setNote(`Namespace ${shortId(id)} created — add a scene to it.`);
                  })
                }
              >
                {busy === "namespace" ? "Creating…" : "Create namespace"}
              </button>
            </div>
            <p className="hint">
              A namespace is a studio and each scene in it is a project. People are invited to the namespace, so one link
              opens every scene in it.
            </p>
            {nsLoading && <p className="empty">Loading namespaces…</p>}
            {nsError && <pre className="err">{nsError.message}</pre>}
            {nsList.length > 0 && (
              <ul className="ns-list">
                {nsList.map((ns, i) => {
                  const id = namespaceIdOf(ns);
                  if (!id) return null;
                  return (
                    <li key={id ?? i}>
                      <span className="mono ns-id" title={id}>
                        {id}
                      </span>
                      <button className="ghost small" disabled={busy !== null} onClick={() => void run(id, () => makeIn(id))}>
                        {busy === id ? "Creating…" : "Add scene"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  async function createBoth() {
    await run("both", async () => {
      const ns = await createNamespace({ applicationId: applicationId! });
      const id = namespaceIdOf(ns);
      if (!id) throw new Error("namespace created but no id came back");
      // Directly in the namespace, not a subgroup: the invite card mints a
      // namespace invitation from the context's group, which must be the namespace.
      await makeIn(id);
    });
  }
}
