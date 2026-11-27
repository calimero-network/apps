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

  // Creating needs the person's passkey, which a node accepts only on the page
  // it serves: a small window opens the page for that alone. The names are typed
  // here; the page creates the workspace with them and closes, and the
  // extension chooses it and opens this popup again.
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [self, setSelf] = useState("");
  const [invite, setInvite] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await ask({ type: "signIn", intent: "create", workspace: { name: name.trim(), self: self.trim() } });
      const after = await ask<Workspace[]>({ type: "listWorkspaces" });
      setList(after);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };
  const inviteOk = /^https?:\/\/\S+[?#&]invite=/.test(invite.trim());

  const startForm = (
    <form
      className="card stack"
      style={{ gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div>
        <p className="strong">Start a workspace</p>
        <p className="small muted" style={{ marginTop: 2 }}>
          For you and your team. You&apos;re its owner and invite people when you&apos;re ready.
        </p>
      </div>
      <div className="field">
        <label htmlFor="ws-name">Workspace name</label>
        <input id="ws-name" className="input" placeholder="e.g. Product team" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ws-self">Your name, as your team sees it</label>
        <input id="ws-self" className="input" placeholder="e.g. Alex" maxLength={48} value={self} onChange={(e) => setSelf(e.target.value)} />
      </div>
      <button type="submit" className="btn primary block" disabled={creating || !name.trim()}>
        {creating ? <Spinner size={14} /> : null}
        {creating ? "Approve with your passkey…" : "Create workspace"}
      </button>
      {creating && <p className="small muted">A small window asks for your passkey, then closes.</p>}
    </form>
  );
  const joinForm = (
    <form
      className="card stack"
      style={{ gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (inviteOk) void chrome.tabs.create({ url: invite.trim() });
      }}
    >
      <div>
        <p className="strong">Join your team</p>
        <p className="small muted" style={{ marginTop: 2 }}>
          Got an invite link? Open it here, join, then pick the workspace in this list.
        </p>
      </div>
      <div className="hstack" style={{ gap: 8 }}>
        <input className="input" aria-label="Invite link" placeholder="https://…?invite=…" value={invite} onChange={(e) => setInvite(e.target.value)} />
        <button type="submit" className="btn" disabled={!inviteOk}>
          Join
        </button>
      </div>
    </form>
  );
  const slogan = (
    <div className="slogan" aria-label="About Sylence">
      <p className="slogan-eyebrow">Private meeting notes</p>
      <p className="slogan-line">Every word remembered. Only your team can listen.</p>
      <ul className="slogan-points">
        <li>Transcribed on your laptop, no bot in the call</li>
        <li>Sealed in a secure enclave</li>
        <li>Read, search and act on it together</li>
      </ul>
    </div>
  );

  return (
    <main className="body">
      <div className="hstack" style={{ alignItems: "flex-start" }}>
        {canClose && (
          <button className="icon-btn" aria-label="Back" onClick={onDone} style={{ marginLeft: -6 }}>
            <BackIcon size={16} />
          </button>
        )}
        <div className="grow">
          <h1 className="title">{list && list.length === 0 ? "Create your first workspace" : "Choose a workspace"}</h1>
          <p className="subtitle">Meetings you record are saved there, for everyone in it to read.</p>
        </div>
      </div>
      {list === null ? (
        <div className="hero" aria-busy="true">
          <Spinner size={18} />
        </div>
      ) : list.length === 0 && !error ? (
        <>
          {startForm}
          {joinForm}
          {slogan}
        </>
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
      {list && list.length > 0 &&
        (form ? (
          <>
            {startForm}
            {joinForm}
          </>
        ) : (
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setForm(true)}>
            Create or join another workspace
          </button>
        ))}
    </main>
  );
}
