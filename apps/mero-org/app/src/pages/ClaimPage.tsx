import { useState } from "react";
import type { MemberView } from "../backend";
import { messageOf, type OrgState } from "../useOrg";

/** True when the signed-in account has no member row yet (e.g. the founder, who is an admin but never claimed). Unknown account → false. */
export function needsClaim(members: MemberView[], myAccount: string): boolean {
  return !!myAccount && !members.some((m) => m.account === myAccount);
}

/** The in-org claim: same form as the join page, without the invitation. The refresh after `run` makes the row appear and the Gate proceeds. */
export function ClaimPage({ state, onSwitchOrg }: { state: OrgState; onSwitchOrg: () => void }) {
  const [profile, setProfile] = useState({ displayName: "", handle: "" });
  const ready = !!profile.displayName.trim() && !!profile.handle.trim();

  function claim() {
    const displayName = profile.displayName.trim(), handle = profile.handle.trim();
    void state.run(async (b) => {
      try { await b.claimMembership(displayName, handle); } catch (e) {
        // A stale read: the row already exists, the refresh will show it.
        if (!/already a member/.test(messageOf(e))) throw e;
      }
    });
  }

  return (
    <main className="center-card join">
      <h1>Welcome. Who are you?</h1>
      <p className="muted">{state.org?.name ? `Tell ${state.org.name} how to show you.` : "Tell the org how to show you."}</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (ready) claim(); }}>
        <label>Name<input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></label>
        <label>Handle<input value={profile.handle} onChange={(e) => setProfile({ ...profile, handle: e.target.value })} /></label>
        <button type="submit" className="primary" disabled={!ready || state.busy}>Join</button>
      </form>
      {state.error && <p role="alert" className="err">{state.error}</p>}
      <button type="button" className="small link" onClick={onSwitchOrg}>Switch org</button>
    </main>
  );
}
