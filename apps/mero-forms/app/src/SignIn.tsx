import { useCallback, useEffect, useRef, useState } from "react";
import { CalimeroError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { dropInvite, joinedOrg, pendingInvite, type PendingInvite } from "./lib/orgs";
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

  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} data-testid="signin-modal">
      <div className="dialog-body">
        <h2>{invited ? "You're invited" : "Sign in"}</h2>
        <p className="empty">
          {invited ? "Sign in, or create an account, to join the workspace you were invited to. " : ""}
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
 * Signed out, it offers the sign-in first; the token survives the sign-up.
 */
export function InvitationPrompt({ onJoined }: { onJoined: () => void }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const ref = useRef<HTMLDialogElement | null>(null);
  const ready = api.session.status === "signed-out" || api.session.status === "signed-in";
  useDialog(ref, !!invite && ready && !signingIn);

  useEffect(() => {
    if (signedIn) setSigningIn(false);
  }, [signedIn]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
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
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, onJoined]);

  if (!invite) return null;

  return (
    <>
      <dialog ref={ref} className="dialog" data-testid="invitation-dialog">
        <div className="dialog-body">
          <h2>You&apos;re invited to Mero Forms</h2>
          <p className="empty">
            Joining makes you a member of the organization this workspace lives in. An admin then
            adds you to the team to give you its forms and responses.
          </p>
          {error && (
            <pre className="err" role="alert" data-testid="invitation-error">
              {error}
            </pre>
          )}
          {signedIn ? (
            <button type="button" onClick={() => void join()} disabled={busy} data-testid="invitation-join">
              {busy ? "Joining…" : "Join"}
            </button>
          ) : (
            <button type="button" onClick={() => setSigningIn(true)} data-testid="invitation-signin">
              Sign in to join
            </button>
          )}
          <button type="button" className="ghost" onClick={dismiss} disabled={busy}>
            Not now
          </button>
        </div>
      </dialog>
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}
