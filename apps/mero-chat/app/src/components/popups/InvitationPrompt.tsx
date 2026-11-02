import { useEffect, useRef, useState } from "react";
import { styled } from "styled-components";

import BaseModal from "../common/popups/BaseModal";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { setStoredGroupAlias } from "../../constants/config";
import { getMessengerDisplayName } from "../../utils/messengerName";
import { dropInvite, pendingInvite } from "../../utils/invitation";
import { enterJoinedWorkspaceForName, enterWorkspace } from "../../utils/enterWorkspace";
import { log } from "../../utils/logger";

/**
 * Offers an opened invitation link once the person is signed in: "Join" redeems
 * the org invite token and enters the workspace (asking for a name first if
 * they have none). The token was taken off the address bar before React
 * mounted (`captureInvite` in `main.tsx`), so it survives the passkey sign-up.
 *
 * v1 used mero-react's `InvitationDialog` over a signed namespace invitation;
 * the steps are the same, the dialog is this app's own.
 */

const Container = styled.div`
  padding: 0.125rem 0;
  min-width: 280px;
`;

const Title = styled.div`
  color: var(--glass-ink);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 0.5rem;
`;

const Message = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.85rem;
  line-height: 1.5;
  margin-bottom: 1.25rem;
`;

const ErrorText = styled.div`
  color: var(--glass-bad-ink);
  font-size: 0.8rem;
  margin-bottom: 1rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`;

const Button = styled.button<{ $primary?: boolean }>`
  padding: 0.5rem 1.1rem;
  border-radius: 10px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${({ $primary }) => ($primary ? "transparent" : "color-mix(in srgb, var(--glass-ink) 10%, transparent)")};
  background: ${({ $primary }) =>
    $primary ? "var(--glass-ink)" : "color-mix(in srgb, var(--glass-ink) 6%, transparent)"};
  color: ${({ $primary }) => ($primary ? "var(--glass-on-ink)" : "var(--glass-ink)")};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface Props {
  enabled: boolean;
}

export default function InvitationPrompt({ enabled }: Props) {
  const api = useRef(new GroupApiDataSource());
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(enabled ? pendingInvite() : null);
  }, [enabled]);

  if (!token) return null;

  const dismiss = () => {
    dropInvite();
    setToken(null);
    setError("");
  };

  const join = async () => {
    setBusy(true);
    setError("");
    const res = await api.current.joinGroup({ invitation: token });
    if (res.error || !res.data) {
      setBusy(false);
      setError(res.error?.message || "This invitation could not be redeemed.");
      return;
    }
    const { groupId, memberIdentity } = res.data;
    dropInvite();
    const meta = await api.current.getGroupMetadata(groupId).catch(() => null);
    const alias = meta?.data?.name?.trim();
    if (alias) setStoredGroupAlias(groupId, alias);
    log.info("InvitationPrompt", `joined workspace ${groupId}`);
    const name = getMessengerDisplayName();
    if (name) enterWorkspace(api.current, groupId, name, memberIdentity);
    else enterJoinedWorkspaceForName(groupId);
  };

  return (
    <BaseModal
      toggle={<span />}
      open
      onOpenChange={(open) => {
        if (!open && !busy) dismiss();
      }}
      content={
        <Container>
          <Title>You're invited to a workspace</Title>
          <Message>Join it to see its channels and message its members in Mero Chat.</Message>
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Actions>
            <Button onClick={dismiss} disabled={busy}>
              Not now
            </Button>
            <Button $primary onClick={() => void join()} disabled={busy}>
              {busy ? "Joining…" : "Join workspace"}
            </Button>
          </Actions>
        </Container>
      }
    />
  );
}
