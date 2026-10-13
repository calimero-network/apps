import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoginModal, useAccountEnrolment, useJoinInvitation, useMero } from "@calimero-network/mero-react";
import type { JoinInvitationResult } from "@calimero-network/mero-react";
import { MeroOrgClient } from "../generated/MeroOrgClient";
import { nodeBackend } from "../backend";
import { clearStashedInvite, stashInviteFromHash, type InviteLink } from "../invite-link";
import { writePick } from "../pick";

export interface JoinDeps {
  join: (input: { namespaceId: string; invitation: InviteLink["invitation"] }) => Promise<JoinInvitationResult>;
  listGroupContexts: (namespaceId: string) => Promise<{ contextId: string }[]>;
  claim: (contextId: string, displayName: string, handle: string) => Promise<{ account: string; status: string }>;
}
export type JoinOutcome = { ok: true; contextId: string; account: string } | { ok: false; final: boolean; reason: string };

/** Steps 3–5 of the join flow, transport-free so they can be tested. */
export async function runJoin(link: InviteLink, profile: { displayName: string; handle: string }, deps: JoinDeps): Promise<JoinOutcome> {
  const joined = await deps.join({ namespaceId: link.namespaceId, invitation: link.invitation });
  if (!joined.ok) return { ok: false, final: joined.final, reason: joined.reason };
  const contexts = await deps.listGroupContexts(link.namespaceId);
  const first = contexts[0];
  if (!first) return { ok: false, final: true, reason: "The org has no context yet; ask the admin." };
  try {
    const member = await deps.claim(first.contextId, profile.displayName, profile.handle);
    return { ok: true, contextId: first.contextId, account: member.account };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // A second device of someone already in: the namespace join succeeded and the row exists.
    if (/already a member/.test(reason)) return { ok: true, contextId: first.contextId, account: "" };
    return { ok: false, final: /display_name|handle/.test(reason), reason };
  }
}

export function JoinPage() {
  const { isAuthenticated, isLoading, mero, admin, connectToNode } = useMero();
  const enrolment = useAccountEnrolment();
  const { joinInvitation } = useJoinInvitation();
  const navigate = useNavigate();
  // Read once, during the first render: the wallet's callback is read during render too, and the hash must be gone before anything else looks.
  const linkRef = useRef<InviteLink | null | undefined>(undefined);
  if (linkRef.current === undefined) linkRef.current = stashInviteFromHash();
  const link = linkRef.current;
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);
  const [profile, setProfile] = useState({ displayName: "", handle: "" });
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  // The name form comes first (step 5 needs it), then join + claim run together.
  useEffect(() => {
    if (!link || !isAuthenticated || !mero || !admin || !submitted || started.current) return;
    started.current = true;
    void runJoin(link, profile, {
      join: joinInvitation,
      listGroupContexts: (ns) => admin.listGroupContexts(ns),
      claim: (ctx, displayName, handle) => nodeBackend(new MeroOrgClient(mero, ctx)).claimMembership(displayName, handle),
    })
      .catch((e: unknown): JoinOutcome => ({ ok: false, final: false, reason: e instanceof Error ? e.message : String(e) }))
      .then((o) => {
        setOutcome(o);
        if (o.ok) {
          writePick({ contextId: o.contextId, namespaceId: link.namespaceId });
          clearStashedInvite();
          navigate("/me");
        }
      });
  }, [link, isAuthenticated, mero, admin, submitted, profile, joinInvitation, navigate, attempt]);

  if (!link) return <main className="center-card join"><h1>This link is not an invitation</h1><p className="muted">Ask the person who sent it for a fresh invitation link.</p></main>;
  if (isLoading) return <main className="center-card join">Connecting…</main>;
  if (!isAuthenticated) {
    return (
      <main className="center-card join">
        <h1>You have been invited</h1>
        <p>Sign in with your account, or connect your Calimero Desktop node.</p>
        <LoginModal isOpen onClose={() => {}} onConnect={(url) => connectToNode(url)}
          cloud={{ onEnrol: () => void enrolment.goToWallet(), note: enrolment.note, walletUrl: enrolment.walletUrl, customWallet: enrolment.customWallet }}
          initialTab="cloud" />
      </main>
    );
  }
  if (outcome && !outcome.ok) {
    return (
      <main className="center-card join">
        <h1>Could not join</h1>
        <p role="alert" className="err">{outcome.reason}</p>
        {!outcome.final && <button type="button" onClick={() => { started.current = false; setOutcome(null); setAttempt((n) => n + 1); }}>Retry</button>}
        {outcome.final && /display_name|handle/.test(outcome.reason) && <button type="button" onClick={() => { started.current = false; setOutcome(null); setSubmitted(false); }}>Change name</button>}
      </main>
    );
  }
  if (submitted) return <main className="center-card join">Joining the org…</main>;
  return (
    <main className="center-card join">
      <h1>Welcome. Who are you?</h1>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (profile.displayName && profile.handle) setSubmitted(true); }}>
        <label>Name<input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></label>
        <label>Handle<input value={profile.handle} onChange={(e) => setProfile({ ...profile, handle: e.target.value })} /></label>
        <button type="submit" className="primary" disabled={!profile.displayName || !profile.handle}>Join</button>
      </form>
    </main>
  );
}
