import { useEffect, useRef, useState, type ReactNode } from "react";
import { describeError } from "@calimero-apps/connect";
import { SignInPanel as SharedSignInPanel } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import {
  SPENT_INVITE,
  dropInvite,
  isSpentInvite,
  joinedOrg,
  listOrgs,
  pendingInvite,
  type PendingInvite,
} from "./lib/orgs";
import { setActive } from "./lib/workspaceStore";
import { LISTING } from "./session";
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
 * The shared sign-in body (`@calimero-apps/passkey`): the sign-in popup and
 * the invitation page both render it, so the copy and the passkey flow
 * (create your account and join, join with a passkey, the two-prompt
 * sign-up) are the same wherever a visitor starts.
 */
function SignInPanel({ titleId }: { titleId: string }) {
  const { api } = useSessionApi();
  return (
    <SharedSignInPanel
      api={api}
      appName="Mero Forms"
      joining="the workspace"
      invited={pendingInvite() !== null}
      listing={LISTING}
      titleId={titleId}
      classNames={{ text: "empty", error: "err" }}
    />
  );
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
  useDialog(ref, open);

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} data-testid="signin-modal" aria-labelledby="signin-title">
      <div className="dialog-body">
        <SignInPanel titleId="signin-title" />
        <button type="button" className="ghost" onClick={onClose} disabled={api.busy}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** What the screen says once the invitation can no longer be accepted. */
type Outcome = { kind: "member"; invite: PendingInvite } | { kind: "spent" };

/**
 * The invitation screens, wrapped around the app because a link can land on
 * any page. `main.tsx` took `?invite=` into storage before React mounted, so
 * the token survives a sign-up. While it is pending the visitor sees a page
 * about the invitation instead of the app (the address, and the app's hash
 * route, is left alone, so a deep link opens where it pointed afterwards):
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's popup. "Not now" shows the landing page and keeps
 *    the token, so signing in later still asks.
 *  - signed in: "Join this workspace?" straight away. It asks rather than
 *    joins: joining puts you in someone's organization.
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * org, so a link that names its org is checked against the account's orgs
 * first, and a member is told so instead of being asked. A spent invite (used,
 * expired, revoked) is said plainly, never dropped silently.
 */
export function InvitationHost({ onJoined, children }: { onJoined: () => void; children: ReactNode }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const client = signedIn?.client ?? null;
  useEffect(() => {
    if (!client) return;
    const current = pendingInvite();
    if (current && api.joinedInvite === current.token) {
      // Signed up from the invitation page with this invite: already joined.
      dropInvite();
      setInvite(null);
      if (current.workspace) setActive({ appId: current.workspace, org: current.org });
      onJoined();
      return;
    }
    setInvite(current);
    const org = current?.org;
    if (!current || !org) return;
    let live = true;
    setChecking(true);
    listOrgs(client)
      .then((orgs) => {
        if (!live || !orgs.some((o) => o.orgId === org)) return;
        dropInvite();
        setInvite(null);
        setOutcome({ kind: "member", invite: current });
      })
      // Unknown membership: ask, as for a link that names no org.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
    // `api.joinedInvite` is set before the session signs in, so it is current here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  if (outcome) {
    const member = outcome.kind === "member";
    const done = () => {
      if (outcome.kind === "member" && outcome.invite.workspace) {
        setActive({ appId: outcome.invite.workspace, org: outcome.invite.org });
        onJoined();
      }
      setOutcome(null);
    };
    return (
      <main className="invitation-page">
        <section className="dialog dialog-body" aria-labelledby="invite-outcome-title" data-testid="invitation-outcome">
          <h2 id="invite-outcome-title">{member ? "You're already in this workspace" : "This invite cannot be used"}</h2>
          <p className="empty">
            {member
              ? "The invitation was for a workspace you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for."
              : SPENT_INVITE}
          </p>
          <button type="button" onClick={done} data-testid="invitation-continue">
            {member ? "Open the workspace" : "Continue"}
          </button>
        </section>
      </main>
    );
  }

  if (!invite) return <>{children}</>;
  if (api.session.status === "connecting") return <>{children}</>;

  if (!signedIn) {
    if (deferred) return <>{children}</>;
    return (
      <main className="invitation-page">
        <section className="dialog dialog-body" aria-labelledby="invite-signin-title" data-testid="invitation-page">
          <SignInPanel titleId="invite-signin-title" />
          <button
            type="button"
            className="ghost"
            onClick={() => setDeferred(true)}
            disabled={api.busy}
            data-testid="invitation-later"
          >
            Not now
          </button>
        </section>
      </main>
    );
  }

  const dismiss = () => {
    dropInvite();
    setInvite(null);
    setError(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
      setInvite(null);
      if (invite.workspace) setActive({ appId: invite.workspace, org });
      onJoined();
    } catch (e) {
      if (isSpentInvite(e)) {
        dropInvite();
        setInvite(null);
        setOutcome({ kind: "spent" });
      } else {
        // The cluster unreachable: the token is kept for another try.
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      signedIn.after();
    }
  };

  return (
    <main className="invitation-page">
      <section className="dialog dialog-body" aria-labelledby="invite-join-title" data-testid="invitation-dialog">
        <h2 id="invite-join-title">Join this workspace?</h2>
        <p className="empty">
          You were invited to a workspace on Mero Forms. Joining makes you a member of the organization it lives
          in. An admin then adds you to the team to give you its forms and responses.
        </p>
        {error && (
          <pre className="err" role="alert" data-testid="invitation-error">
            {error}
          </pre>
        )}
        <button type="button" onClick={() => void join()} disabled={busy || checking} data-testid="invitation-join">
          {busy || checking ? "Joining…" : error ? "Try again" : "Join"}
        </button>
        <button type="button" className="ghost" onClick={dismiss} disabled={busy}>
          Not now
        </button>
      </section>
    </main>
  );
}
