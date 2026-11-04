import { useEffect, useMemo, useState } from "react";
import { styled } from "styled-components";
import { AppListing, PasskeySignIn, type PasskeySignInApi } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import BaseModal from "../../components/common/popups/BaseModal";
import { LISTING, signIn, signUp, useCalimero } from "../../api/calimero";
import { pendingInvite } from "../../utils/invitation";
import { setMessengerDisplayName } from "../../utils/messengerName";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect popup (a node URL, node login, the Cloud wallet): on Calimero 1.0
 * the build already names its cluster (`merod local` in dev, the Cloud
 * cluster in production) and an account is a passkey.
 */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 280px;
`;

const Title = styled.div`
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
  isOpen: boolean;
  onClose: () => void;
}

export default function SignInPopup({ isOpen, onClose }: Props) {
  const { status, message } = useCalimero();
  const [busy, setBusy] = useState(false);
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (isOpen && status === "signed-in") onClose();
  }, [isOpen, status, onClose]);

  const api = useMemo<PasskeySignInApi>(() => {
    const run = async (ceremony: () => Promise<void>) => {
      setBusy(true);
      try {
        await ceremony();
      } catch {
        // `message` carries the reason (none for a dismissed prompt).
      } finally {
        setBusy(false);
      }
    };
    return {
      busy,
      error: status === "unconfigured" || status === "listing" ? null : message,
      signIn: () => run(signIn),
      signUp: (name = "") =>
        run(async () => {
          const chosen = name.trim();
          await signUp(chosen);
          // A name they chose is the one the workspace picker offers.
          setMessengerDisplayName(chosen);
        }),
    };
  }, [busy, status, message]);

  return (
    <BaseModal
      toggle={<span />}
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      content={
        <Container data-testid="signin-popup">
          <Title>{invited ? "You're invited" : "Sign in to Mero Chat"}</Title>
          <Hint>
            {invited ? "Sign in, or create an account, to join the workspace you were invited to. " : ""}
            Your account is a passkey: nothing to remember, nothing to leak.
          </Hint>

          {status === "connecting" && <Hint>Connecting…</Hint>}
          {status === "listing" && <AppListing {...LISTING} />}
          {status === "unconfigured" && <ErrorText role="alert">{message}</ErrorText>}

          {status === "signed-out" && <PasskeySignIn api={api} askName />}
        </Container>
      }
    />
  );
}
