import { useCallback, useEffect, useState } from "react";
import type { AuthState, Workspace } from "../../lib/messages";
import { AlertIcon, BackIcon, CheckIcon, RefreshIcon, Spinner } from "../icons";
import { ask } from "../rpc";

export function Workspaces({ auth, onDone, canClose = false }: { auth: AuthState; onDone: () => void; canClose?: boolean }) {
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setList(null);
    try {
      setList(await ask<Workspace[]>({ type: "listWorkspaces" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (w: Workspace) => {
    await ask({ type: "chooseWorkspace", workspace: w });
    onDone();
  };

  // The page forgets its session once it hands it to the extension, so a plain
  // tab would ask for a passkey again (and invite a second account). The
  // sign-in window instead offers a new workspace (`intent: "create"`) before
  // it hands over; the workspace that appears is then chosen.
  const [creating, setCreating] = useState(false);
  const create = async () => {
    setCreating(true);
    setError(null);
    const before = new Set((list ?? []).map((w) => w.appId));
    try {
      await ask({ type: "signIn", intent: "create" });
      const after = await ask<Workspace[]>({ type: "listWorkspaces" });
      setList(after);
      const made = after.find((w) => !before.has(w.appId));
      if (made) await choose(made);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="body">
      <div className="hstack" style={{ alignItems: "flex-start" }}>
        {canClose && (
          <button className="icon-btn" aria-label="Back" onClick={onDone} style={{ marginLeft: -6 }}>
            <BackIcon size={16} />
          </button>
        )}
        <div className="grow">
          <h1 className="title">Choose a workspace</h1>
          <p className="subtitle">Meetings you record are saved there, for everyone in it to read.</p>
        </div>
      </div>
      {list === null ? (
        <div className="hero" aria-busy="true">
          <Spinner size={18} />
        </div>
      ) : list.length === 0 && !error ? (
        <div className="card stack" style={{ gap: 12 }}>
          <div>
            <p className="strong">No workspace yet</p>
            <p className="small muted" style={{ marginTop: 2 }}>
              Sign in once more with the same passkey and create one in the window that opens.
            </p>
          </div>
          <button className="btn primary block" onClick={() => void create()} disabled={creating}>
            {creating ? <Spinner size={14} /> : null}
            {creating ? "Waiting for the sign-in window…" : "Create a workspace"}
          </button>
        </div>
      ) : (
        <div className="list" role="radiogroup" aria-label="Workspaces">
          {list.map((w) => (
            <button
              key={w.appId}
              className="row"
              role="radio"
              aria-checked={auth.workspace?.appId === w.appId}
              onClick={() => void choose(w)}
            >
              <span className="tile" style={{ width: 28, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 600 }} aria-hidden="true">
                {w.name.trim().charAt(0).toUpperCase() || "W"}
              </span>
              <span className="grow">
                <span className="name">{w.name}</span>
              </span>
              <span className="tick">{auth.workspace?.appId === w.appId ? <CheckIcon size={16} /> : null}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="banner bad" role="alert">
          <AlertIcon size={14} />
          <span className="grow">{error}</span>
          <button className="icon-btn" aria-label="Try again" onClick={() => void load()} style={{ width: 20, height: 20, color: "inherit" }}>
            <RefreshIcon size={14} />
          </button>
        </div>
      )}
      {list && list.length > 0 && (
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={create} disabled={creating}>
          Create another workspace
        </button>
      )}
    </main>
  );
}
