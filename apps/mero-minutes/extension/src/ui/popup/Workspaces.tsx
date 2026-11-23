import { useCallback, useEffect, useState } from "react";
import { Refresh } from "@calimero-network/mero-icons";
import type { AuthState, Workspace } from "../../lib/messages";
import { CheckIcon, Spinner } from "../icons";
import { ask } from "../rpc";

export function Workspaces({ auth, onDone }: { auth: AuthState; onDone: () => void }) {
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
  // sign-in window instead offers the first workspace before it hands over.
  const [creating, setCreating] = useState(false);
  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await ask({ type: "signIn" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="body">
      <div>
        <h1 className="title">Choose a workspace</h1>
        <p className="subtitle">Meetings you record are saved there, for everyone in it to read.</p>
      </div>
      {list === null ? (
        <div className="hero" aria-busy="true">
          <Spinner size={20} />
        </div>
      ) : list.length === 0 && !error ? (
        <div className="card">
          <p style={{ margin: 0, fontWeight: 600 }}>No workspace yet</p>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Sign in once more with the same passkey and create one in the window that opens.
          </p>
          <button className="btn primary block" onClick={() => void create()} disabled={creating}>
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
              <span className="grow">
                <span className="name">{w.name}</span>
              </span>
              <span className="tick">{auth.workspace?.appId === w.appId ? <CheckIcon /> : null}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="banner bad" role="alert">
          <span className="grow">{error}</span>
          <button className="icon-btn" aria-label="Try again" onClick={() => void load()}>
            <Refresh width={16} height={16} />
          </button>
        </div>
      )}
      {list && list.length > 0 && (
        <button className="btn link" onClick={create}>
          Create another workspace
        </button>
      )}
    </main>
  );
}
