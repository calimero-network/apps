import { useEffect, useMemo, useState } from "react";
import { styled } from "styled-components";
import {
  AppListing,
  PasskeySignIn,
  type PasskeySignInApi,
} from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import {
  LISTING,
  approveSignUp,
  cancelSignUp,
  signIn,
  signUp,
  useCalimero,
} from "../../api/calimero";
import { setMessengerDisplayName } from "../../utils/messengerName";

/**
 * The body of the sign-in: a title, what an account is, and "Continue with
 * passkey" / "Create a passkey". One component for the sign-in popup and the
 * invitation page, so the two never say different things or run different
 * ceremonies. `invited` switches the copy to the invitation's.
 */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 280px;
`;

const Title = styled.h2`
  margin: 0;
  color: var(--glass-ink);
  font-size: 16px;
  font-weight: 600;
`;

const Hint = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.84rem;
  line-height: 1.5;
`;

const ErrorText = styled.div`
  color: var(--glass-bad-ink);
  font-size: 0.82rem;
`;

interface Props {
  invited: boolean;
  /** Runs before a ceremony starts (the stale-storage purge). */
  beforeCeremony?: () => void;
  /** Reports a ceremony in flight, so the caller can hold its own controls. */
  onBusy?: (busy: boolean) => void;
  testId?: string;
}

export default function SignInPanel({
  invited,
  beforeCeremony,
  onBusy,
  testId = "signin-popup",
}: Props) {
  const {
    status,
    message,
    signUpAccess,
    passkeyUnknown,
    noAccountHere,
    knownAccount,
    hasInvite,
    signUpStage,
  } = useCalimero();
  const [busy, setBusy] = useState(false);

  // Closing the sign-in mid sign-up ends it, so nothing waits on a click.
  useEffect(() => () => cancelSignUp(), []);

  const api = useMemo<PasskeySignInApi>(() => {
    const run = async (ceremony: () => Promise<void>) => {
      beforeCeremony?.();
      setBusy(true);
      onBusy?.(true);
      try {
        await ceremony();
      } catch {
        // `message` carries the reason (none for a dismissed prompt).
      } finally {
        setBusy(false);
        onBusy?.(false);
      }
    };
    return {
      busy,
      error: status === "unconfigured" || status === "listing" ? null : message,
      signUpAccess,
      passkeyUnknown,
      noAccountHere,
      knownAccount,
      hasInvite,
      // A sign-up's second prompt starts from its own click.
      stage: signUpStage,
      approve: approveSignUp,
      cancelSignUp,
      signIn: () => run(signIn),
      signUp: (name = "") =>
        run(async () => {
          const chosen = name.trim();
          await signUp(chosen);
          // A name they chose is the one the workspace picker offers.
          setMessengerDisplayName(chosen);
        }),
    };
  }, [
    busy,
    status,
    message,
    signUpAccess,
    passkeyUnknown,
    noAccountHere,
    knownAccount,
    hasInvite,
    signUpStage,
    beforeCeremony,
    onBusy,
  ]);

  return (
    <Container data-testid={testId}>
      <Title>{invited ? "You're invited" : "Sign in to Mero Chat"}</Title>
      <Hint data-testid="signin-desc">
        {invited
          ? "You've been invited to join the workspace in Mero Chat. "
          : ""}
        Your account is a passkey: nothing to remember, nothing to leak.
      </Hint>

      {status === "connecting" && <Hint>Connecting…</Hint>}
      {status === "listing" && <AppListing {...LISTING} />}
      {status === "unconfigured" && (
        <ErrorText role="alert">{message}</ErrorText>
      )}

      {status === "signed-out" && <PasskeySignIn api={api} invited={invited} joining="the workspace" />}
    </Container>
  );
}
