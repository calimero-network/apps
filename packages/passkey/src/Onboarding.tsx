import { useEffect, useState, type ReactNode } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { AppListing } from "./AppListing";
import type { ListingProps } from "./listing";
import { PasskeySignIn } from "./PasskeySignIn";
import { describeTarget, type SessionApi } from "./session";

/**
 * The sign-in, sign-up and invitation screens every app shows, built on
 * `<PasskeySignIn>`. Each app keeps its look by passing its own class names
 * (the slots below) and theming the control with `--passkey-*` tokens; the
 * flow, the copy and the test ids are the same in every app.
 */

/** An app's classes for the screens' slots. Every slot is optional. */
export interface OnboardingClassNames {
  /** The screen's outer element (a card, a dialog body). */
  root?: string;
  /** An element inside the root that holds everything, for a card in a section. */
  inner?: string;
  title?: string;
  /** The body copy under the title. */
  text?: string;
  /** Around `<PasskeySignIn>`. */
  control?: string;
  /** A failure the screen shows (a join that did not go through, an unconfigured cluster). */
  error?: string;
  /** The row of buttons under the copy. */
  actions?: string;
  /** The main button of a screen (Join, Continue). */
  primary?: string;
  /** The quiet button ("Not now"). */
  secondary?: string;
}

type Heading = "h1" | "h2" | "h3" | "div";

function Title({ as, id, className, children }: { as: Heading; id?: string; className?: string; children: ReactNode }) {
  const Tag = as;
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

function Frame({
  classNames,
  testId,
  labelledBy,
  children,
}: {
  classNames: OnboardingClassNames;
  testId: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <section className={classNames.root} data-testid={testId} aria-labelledby={labelledBy}>
      {classNames.inner ? <div className={classNames.inner}>{children}</div> : children}
    </section>
  );
}

/** The one line every sign-in screen says about accounts. */
export const ACCOUNTS_ARE_PASSKEYS = "Accounts are passkeys: nothing to remember, nothing to leak.";

export interface SignInPanelProps {
  api: SessionApi;
  /** The app's name, as the copy says it ("Mero CRM"). */
  appName: string;
  /** What an invite joins, as a noun phrase: "the workspace", "the team". */
  joining: string;
  /** The page holds an invite. Defaults to the session's `hasInvite`. */
  invited?: boolean;
  /** What the listing page shows on a copy no cluster serves. */
  listing: ListingProps;
  titleId?: string;
  titleAs?: Heading;
  /** Rendered before the title (a dialog's close button). */
  before?: ReactNode;
  classNames?: OnboardingClassNames;
  askName?: boolean;
  /** Shown under the control while signed out (an invitation's "Not now"). */
  children?: ReactNode;
}

/**
 * The sign-in body a popup, a page or an invitation renders: the title and
 * one line ("You're invited" and what to, when the page holds an invite), the
 * cluster's state (connecting, listing, unconfigured), and `<PasskeySignIn>`.
 * The root is a fragment, so a dialog or card of the app's wraps it.
 */
export function SignInPanel({
  api,
  appName,
  joining,
  invited,
  listing,
  titleId,
  titleAs = "h2",
  before,
  classNames = {},
  askName,
  children,
}: SignInPanelProps) {
  const isInvited = invited ?? api.hasInvite ?? false;
  const { session } = api;
  const where = session.status === "signed-out" || session.status === "signed-in" ? describeTarget(session.target) : null;
  const title = isInvited ? "You're invited" : "Sign in or create an account";
  return (
    <>
      {before}
      <Title as={titleAs} id={titleId} className={classNames.title}>
        {title}
      </Title>
      <p className={classNames.text} data-testid="signin-copy">
        {isInvited ? `You've been invited to join ${joining} in ${appName}. ` : ""}
        {ACCOUNTS_ARE_PASSKEYS}
        {where ? ` Connected to ${where}.` : ""}
      </p>
      {session.status === "connecting" && <p className={classNames.text}>Connecting…</p>}
      {session.status === "listing" && <AppListing {...listing} />}
      {session.status === "unconfigured" && (
        <p className={classNames.error} role="alert">
          {session.message}
        </p>
      )}
      {session.status === "signed-out" && (
        <>
          <div className={classNames.control}>
            <PasskeySignIn api={api} joining={joining} invited={isInvited} askName={askName} />
          </div>
          {children}
        </>
      )}
    </>
  );
}

export interface InvitationSignInProps {
  api: SessionApi;
  appName: string;
  joining: string;
  listing: ListingProps;
  /** "Not now": the usual page, the invite kept. */
  onLater: () => void;
  classNames?: OnboardingClassNames;
  titleAs?: Heading;
}

/**
 * Signed out, with an invitation: the invitation said first, then the
 * create-account-and-join path (or "Join with your passkey" for an account
 * this browser has used here). "Not now" shows the usual page and keeps the
 * token, so signing in from there still joins.
 */
export function InvitationSignIn({ api, appName, joining, listing, onLater, classNames = {}, titleAs }: InvitationSignInProps) {
  return (
    <Frame classNames={classNames} testId="invitation-page">
      <SignInPanel
        api={api}
        appName={appName}
        joining={joining}
        invited
        listing={listing}
        titleAs={titleAs}
        classNames={classNames}
      >
        <div className={classNames.actions}>
          <button
            type="button"
            className={classNames.secondary}
            onClick={onLater}
            disabled={api.busy}
            data-testid="invitation-later"
          >
            Not now
          </button>
        </div>
      </SignInPanel>
    </Frame>
  );
}

/** What the invitation screens say once an invite cannot be used. */
export const SPENT_INVITE_COPY =
  "This invite was already used or has expired. Ask the person who invited you for a new link.";

export interface JoinInvitationProps {
  client: Pick<CalimeroClient, "me" | "redeemInvite">;
  token: string;
  /** The org the link named, when it named one: a member of it is told so instead of spending a use. */
  org: string | null;
  appName: string;
  /** What the invite joins, as a noun phrase: "the team". */
  joining: string;
  /** One more sentence on what joining gives, after "Joining makes you a member of its organization". */
  gives?: string;
  /** Forget the pending invite. */
  drop: () => void;
  /** Whether a failed redemption means the invite is spent (used, expired, revoked, unknown). */
  isSpent: (error: unknown) => boolean;
  /** After any request: the app keeps its stored session in step. */
  after: () => void;
  /** Redeemed: what the invite was for is the account's now. */
  onJoined: () => void;
  /** Nothing (more) to accept: back to the usual page. */
  onClose: () => void;
  classNames?: OnboardingClassNames;
  titleAs?: Heading;
}

/**
 * Signed in, with an invitation: "Join {joining}?", asked rather than done,
 * since joining makes you a member of someone else's organization.
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * org, so a link that names its org is checked against the account's orgs
 * first and a member is told so instead. A spent invitation (used, expired,
 * revoked) is said plainly, not dropped silently.
 */
export function JoinInvitation({
  client,
  token,
  org,
  appName,
  joining,
  gives,
  drop,
  isSpent,
  after,
  onJoined,
  onClose,
  classNames = {},
  titleAs = "h2",
}: JoinInvitationProps) {
  const [checking, setChecking] = useState(() => org !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"member" | "spent" | null>(null);

  useEffect(() => {
    if (!org) return;
    let live = true;
    Promise.resolve()
      .then(() => client.me())
      .then((me) => {
        const orgs = (me as { orgs?: Array<{ orgId: string }> }).orgs ?? [];
        if (!live || !orgs.some((o) => o.orgId === org)) return;
        drop();
        setOutcome("member");
      })
      // Unknown membership: ask, as for a link that names no org.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
    // `drop` is the app's; the check runs once per client and link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, org]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await client.redeemInvite(token);
      drop();
      onJoined();
    } catch (e) {
      if (isSpent(e)) {
        drop();
        setOutcome("spent");
      } else {
        // The cluster unreachable, say: the token is kept to try again.
        setError(`The invitation could not be accepted: ${describeError(e)}. Check your connection and try again.`);
      }
    } finally {
      setBusy(false);
      after();
    }
  }

  if (outcome) {
    return (
      <Frame classNames={classNames} testId="invitation-outcome">
        <Title as={titleAs} className={classNames.title}>
          {outcome === "member" ? `You're already in ${joining}` : "This invite cannot be used"}
        </Title>
        <p className={classNames.text}>
          {outcome === "member"
            ? `The invitation was for ${joining}, and you are already a member, so there is nothing to accept. It is still unused for the person it was meant for.`
            : SPENT_INVITE_COPY}
        </p>
        <div className={classNames.actions}>
          <button type="button" className={classNames.primary} onClick={onClose} data-testid="invitation-continue">
            Continue
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame classNames={classNames} testId="invitation-prompt">
      <Title as={titleAs} className={classNames.title}>
        Join {joining}?
      </Title>
      <p className={classNames.text}>
        You were invited to {joining} in {appName}. Joining makes you a member of its organization
        {gives ? `: ${gives}` : "."}
      </p>
      {error && (
        <p className={classNames.error} role="alert" data-testid="invitation-error">
          {error}
        </p>
      )}
      <div className={classNames.actions}>
        <button
          type="button"
          className={classNames.primary}
          onClick={() => void join()}
          disabled={busy || checking}
          data-testid="invitation-join"
        >
          {busy ? "Joining…" : checking ? "Checking…" : error ? "Try again" : "Join"}
        </button>
        <button
          type="button"
          className={classNames.secondary}
          onClick={() => {
            drop();
            onClose();
          }}
          disabled={busy}
          data-testid="invitation-dismiss"
        >
          Not now
        </button>
      </div>
    </Frame>
  );
}
