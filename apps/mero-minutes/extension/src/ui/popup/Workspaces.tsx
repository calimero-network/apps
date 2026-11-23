import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Refresh } from "@calimero-network/mero-icons";
import { workspaceLink } from "../../lib/appHost";
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

  const create = () => void chrome.tabs.create({ url: workspaceLink(auth.page) });

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
            Create one on the Minutes page, then come back here.
          </p>
          <button className="btn primary block" onClick={create}>
            Create a workspace <ExternalLink width={15} height={15} />
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
