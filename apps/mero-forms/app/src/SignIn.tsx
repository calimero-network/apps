import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { describeError } from "@calimero-apps/connect";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import {
  INVITE_SPENT,
  dropInvite,
  inviteRefused,
  joinedOrg,
  listOrgs,
  mintedOrg,
  pendingInvite,
  type PendingInvite,
} from "./lib/orgs";
import { setActive } from "./lib/workspaceStore";
import { LISTING, describeTarget } from "./session";
import { useMaybeSignedIn, useSessionApi } from "./sessionContext";

/** Opens and closes a `<dialog>` as `open` says. */
function useDialog(ref: React.RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom has no showModal.
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [ref, open]);
}

/**
 * The sign-in content: one passkey screen that both signs in and creates an
 * account. Shared by the popup (`SignInModal`) and the invitation page a
 * signed-out invite link lands on (`InvitationPage`), so the copy and the
 * passkey flow cannot drift apart.
 */
function SignInPanel({ invited, titleId }: { invited: boolean; titleId: string }) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;
  return (
    <>
      <h2 id={titleId}>{invited ? "You're invited" : "Sign in or create an account"}</h2>
      <p className="empty">
        {invited ? "You've been invited to join a workspace in Mero Forms. Sign in, or create an account, to accept. " : ""}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ""}
      </p>
      {api.session.status === "connecting" && <p className="empty">Connecting…</p>}
      {api.session.status === "listing" && <AppListing {...LISTING} />}
      {api.session.status === "unconfigured" && (
        <p className="err" role="alert">
          {api.session.message}
        </p>
      )}
      {api.session.status === "signed-out" && <PasskeySignIn api={api} />}
    </>
  );
}

/**
 * What an invite link opened while signed out lands on: the invitation itself,
 * as a page, instead of the landing hero with the invite hidden behind a
 * button. Signing in or creating an account here is the popup's passkey flow
 * (`SignInPanel`); once a session exists `InvitationPrompt` asks to join.
 * "Not now" goes to the landing page and keeps the token.
 */
export function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  const { api } = useSessionApi();
  return (
    <main className="invitation-page" data-testid="invitation-page">
      <section className="dialog dialog-body" aria-labelledby="invitation-page-title">
        <SignInPanel invited titleId="invitation-page-title" />
        <button type="button" className="ghost" onClick={onNotNow} disabled={api.busy} data-testid="invitation-not-now">
          Not now
        </button>
      </section>
    </main>
  );
}

/**
 * A signed-out visitor holding an invite (`?invite=`, taken into storage by
 * `main.tsx`) sees `InvitationPage` instead of `children` (the landing page).
 * The address, and the app's hash route, is left alone, so a deep link opens
 * where it pointed once they are signed in, under the join prompt.
 */
export function InvitationGate({ children }: { children: ReactNode }) {
  const signedIn = useMaybeSignedIn();
  const [later, setLater] = useState(false);
  if (signedIn || later || pendingInvite() === null) return <>{children}</>;
  return <InvitationPage onNotNow={() => setLater(true)} />;
}

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * login popup (node discovery, a node URL, the Cloud wallet): on Calimero 1.0
 * the frontend already knows its cluster (merod local in dev, the Cloud
 * cluster in production) and the account is a passkey.
 */
export function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const ref = useRef<HTMLDialogElement | null>(null);
  const invited = pendingInvite() !== null;
  useDialog(ref, open);

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} data-testid="signin-modal" aria-labelledby="signin-title">
      <div className="dialog-body">
        <SignInPanel invited={invited} titleId="signin-title" />
        <button type="button" className="ghost" onClick={onClose} disabled={api.busy}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/**
 * "Join this workspace?" for an invitation that arrived as a link
 * (`?invite=`, taken into storage before the first render by `captureInvite`).
 * It asks rather than joins: joining puts you in someone's organization.
 * Signed out, the visitor is on `InvitationPage` and this shows nothing; the
 * token survives the sign-up, and this asks the moment a session exists.
 *
 * Someone already in the invite's organization is told so instead: redeeming
 * would spend the invite's single use on a person who needs none of it. The
 * organization is known only for an invite this browser minted (`mintedOrg`);
 * for any other the prompt stays.
 */
export function InvitationPrompt({ onJoined }: { onJoined: () => void }) {
  const signedIn = useMaybeSignedIn();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An invite for an organization this account is already in. */
  const [member, setMember] = useState<PendingInvite | null>(null);
  const [checking, setChecking] = useState(false);
  const ref = useRef<HTMLDialogElement | null>(null);
  useDialog(ref, !!signedIn && !!invite && !checking);

  // The invitation page may have been the way in: re-read once signed in.
  useEffect(() => {
    if (signedIn) setInvite(pendingInvite());
  }, [signedIn]);

  const client = signedIn?.client ?? null;
  useEffect(() => {
    if (!client || !invite) return;
    const org = mintedOrg(invite.token);
    if (!org) return;
    let live = true;
    setChecking(true);
    listOrgs(client)
      .then((orgs) => {
        if (!live || !orgs.some((o) => o.orgId === org)) return;
        dropInvite();
        setMember(invite);
      })
      .catch(() => {
        /* unknown: keep the prompt */
      })
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [client, invite]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
    setMember(null);
  }, []);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
      setInvite(null);
      if (invite.workspace) setActive({ appId: invite.workspace, org });
      onJoined();
    } catch (e) {
      // A refusal (used, expired, revoked) can never succeed: drop it. Anything
      // else (the cluster unreachable) is kept for another try.
      if (inviteRefused(e)) {
        dropInvite();
        setError(INVITE_SPENT);
      } else {
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, onJoined]);

  if (!signedIn || !invite) return null;

  if (member) {
    return (
      <dialog ref={ref} className="dialog" data-testid="invitation-already-member" aria-labelledby="invite-member-title">
        <div className="dialog-body">
          <h2 id="invite-member-title">You&apos;re already in this workspace</h2>
          <p className="empty">
            This invite is for a workspace you are a member of, so it was not used. It is still there for the
            person you meant to send it to.
          </p>
          <button
            type="button"
            onClick={() => {
              if (member.workspace) setActive({ appId: member.workspace, org: mintedOrg(member.token) });
              dismiss();
              onJoined();
            }}
          >
            Open it
          </button>
        </div>
      </dialog>
    );
  }

  return (
    <dialog ref={ref} className="dialog" data-testid="invitation-dialog" aria-labelledby="invite-join-title">
      <div className="dialog-body">
        <h2 id="invite-join-title">You&apos;re invited to Mero Forms</h2>
        <p className="empty">
          Joining makes you a member of the organization this workspace lives in. An admin then
          adds you to the team to give you its forms and responses.
        </p>
        {error && (
          <pre className="err" role="alert" data-testid="invitation-error">
            {error}
          </pre>
        )}
        {!error && (
          <button type="button" onClick={() => void join()} disabled={busy} data-testid="invitation-join">
            {busy ? "Joining…" : "Join"}
          </button>
        )}
        <button type="button" className="ghost" onClick={dismiss} disabled={busy}>
          {error ? "Close" : "Not now"}
        </button>
      </div>
    </dialog>
  );
}
