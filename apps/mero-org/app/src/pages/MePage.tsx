import { useEffect, useState } from "react";
import { useJoinInvitation } from "@calimero-network/mero-react";
import type { EnrolmentView } from "../backend";
import { messageOf } from "../useOrg";
import { type PageProps } from "./Shell";

type JoinNote = { tone: "good" | "bad"; text: string };

export function MePage({ state, myAccount }: PageProps) {
  const { joinInvitation } = useJoinInvitation();
  const me = state.members.find((m) => m.account === myAccount);
  const [profile, setProfile] = useState({ displayName: "", avatar: "" });
  const [mine, setMine] = useState<EnrolmentView[]>([]);
  const [notes, setNotes] = useState<Record<string, JoinNote>>({});
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (me) setProfile({ displayName: me.display_name, avatar: me.avatar }); }, [me?.display_name, me?.avatar]);

  // Re-read when the org's enrolment table moves (the reconciler records a fresh invitation there).
  useEffect(() => {
    let live = true;
    state.backend.myEnrolments().then((rows) => { if (live) { setMine(rows); setError(null); } }, (e: unknown) => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [state.backend, state.enrolments]);

  const waiting = mine.filter((e) => e.state === "invitation_pending" && e.invitation);
  const label = (id: string) => state.apps.find((a) => a.id === id)?.label ?? id.slice(0, 8);

  async function join(e: EnrolmentView) {
    setJoining(e.app);
    try {
      const out = await joinInvitation({ namespaceId: e.app, invitation: JSON.parse(e.invitation) });
      setNotes((n) => ({ ...n, [e.app]: out.ok ? { tone: "good", text: "joined, placement follows" } : { tone: "bad", text: out.reason } }));
    } catch (err) {
      setNotes((n) => ({ ...n, [e.app]: { tone: "bad", text: messageOf(err) } }));
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
      {waiting.length === 0 ? <p className="muted">Nothing waiting. New app access shows up here.</p> : (
        <ul className="waiting">
          {waiting.map((e) => (
            <li key={e.app} className="card">
              <span className="grow">{label(e.app)}</span>
              {notes[e.app] ? <span className={notes[e.app]?.tone === "good" ? "pill pill-good" : "err"}>{notes[e.app]?.text}</span> : null}
              {notes[e.app]?.tone !== "good" && <button type="button" className="primary small" disabled={joining !== null} onClick={() => void join(e)}>Join</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
