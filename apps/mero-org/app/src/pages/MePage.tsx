import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { EnrolmentView } from "../backend";
import { appsToFollow, followApp, type ToFollow } from "../follow";
import { messageOf } from "../useOrg";
import { type PageProps } from "./Shell";

type JoinNote = { tone: "good" | "wait" | "bad"; text: string; final?: boolean };

export function MePage({ state, myAccount }: PageProps) {
  const { admin } = useMero();
  const me = state.members.find((m) => m.account === myAccount);
  const [profile, setProfile] = useState({ displayName: "", avatar: "" });
  const [mine, setMine] = useState<EnrolmentView[]>([]);
  const [held, setHeld] = useState<Set<string> | null>(null);
  const [notes, setNotes] = useState<Record<string, JoinNote>>({});
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heldTick, setHeldTick] = useState(0);

  useEffect(() => { if (me) setProfile({ displayName: me.display_name, avatar: me.avatar }); }, [me?.display_name, me?.avatar]);

  // Re-read when the org's enrolment table moves (the reconciler records an app the account was added to).
  useEffect(() => {
    let live = true;
    state.backend.myEnrolments().then((rows) => { if (live) { setMine(rows); setError(null); } }, (e: unknown) => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [state.backend, state.enrolments]);

  // The namespaces this node already holds: nothing to follow there.
  useEffect(() => {
    if (!admin) return;
    let live = true;
    admin.listNamespaces().then((ns) => { if (live) setHeld(new Set(ns.map((n) => n.namespaceId))); }, (e: unknown) => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [admin, state.enrolments, heldTick]);

  // A follow done in this session stays listed with its outcome, even once the node holds the namespace.
  const waiting: ToFollow[] = held === null ? [] : appsToFollow(mine, state.apps, held);
  const shown = [...waiting, ...appsToFollow(mine, state.apps, new Set()).filter((t) => notes[t.app.id] && !waiting.some((w) => w.app.id === t.app.id))];

  async function join(t: ToFollow) {
    if (!admin) return;
    setJoining(t.app.id);
    try {
      const out = await followApp(admin, t.app);
      const note: JoinNote = out.ok
        ? out.keyReady ? { tone: "good", text: "joined" } : { tone: "wait", text: "joined, the key is on its way: press Join again in a moment" }
        : { tone: "bad", text: out.reason, final: out.final };
      setNotes((n) => ({ ...n, [t.app.id]: note }));
      if (out.ok) setHeldTick((x) => x + 1);
    } finally { setJoining(null); }
  }

  if (!me) return <section className="stack"><h1>Me</h1><p className="empty">You are not a member of this org yet. Open an invitation link to join.</p></section>;

  return (
    <section className="stack">
      <h1>Me</h1>
      <form className="form card-form" onSubmit={(e) => { e.preventDefault(); const p = { displayName: profile.displayName.trim(), avatar: profile.avatar.trim() }; void state.run((b) => b.updateProfile(p)); }}>
        <label>Name<input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></label>
        <label>Avatar URL<input value={profile.avatar} onChange={(e) => setProfile({ ...profile, avatar: e.target.value })} /></label>
        <p className="muted small-text">@{me.handle} · {me.status}</p>
        <div className="row"><button type="submit" className="primary" disabled={state.busy || !profile.displayName.trim()}>Save profile</button></div>
      </form>

      <h2>Waiting for you</h2>
      {error && <p className="err" role="alert">{error}</p>}
      {shown.length === 0 ? <p className="muted">Nothing waiting. New app access shows up here.</p> : (
        <ul className="waiting">
          {shown.map((t) => {
            const note = notes[t.app.id];
            return (
              <li key={t.app.id} className="card">
                <span className="grow">{t.app.label}</span>
                {note ? <span className={note.tone === "good" ? "pill pill-good" : note.tone === "wait" ? "pill pill-wait" : "err"}>{note.text}</span> : null}
                {note?.tone !== "good" && !note?.final && <button type="button" className="primary small" disabled={joining !== null} onClick={() => void join(t)}>{joining === t.app.id ? "Joining…" : "Join"}</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
