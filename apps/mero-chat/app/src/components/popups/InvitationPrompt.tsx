import { useEffect, useRef, useState } from "react";
import { styled } from "styled-components";

import BaseModal from "../common/popups/BaseModal";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { setStoredGroupAlias } from "../../constants/config";
import { getMessengerDisplayName } from "../../utils/messengerName";
import { myOrgs } from "../../api/platform";
import { getAccountId } from "../../api/calimero";
import {
  SPENT_INVITE,
  dropInvite,
  inviteRefused,
  pendingInvite,
  pendingInviteOrg,
  setInvitePromptOpen,
} from "../../utils/invitation";
import { enterJoinedWorkspaceForName, enterWorkspace } from "../../utils/enterWorkspace";
import { log } from "../../utils/logger";
import { askOnConsentPage, consentIntent, consentRequest, frontendBound } from "../../api/consent";

/**
 * Offers an opened invitation link once the person is signed in: "Join" redeems
 * the org invite token and enters the workspace (asking for a name first if
 * they have none). The token was taken off the address bar before React
 * mounted (`captureInvite` in `main.tsx`), so it survives the passkey sign-up
 * on the invitation page (`pages/Login/InvitationPage`).
 *
 * ⚠️ Someone already in the workspace is not offered Join. Redeeming spends
 * the link's single use, so the owner trying their own link used to leave the
 * person it was meant for with "unknown invite". When the link names its
 * workspace (`&org=`) and this account's orgs include it, the token is dropped
 * unspent and the prompt says so; when it cannot tell, it asks as before.
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
  const [spent, setSpent] = useState(false);
  /** null while it is being checked; the workspace when this account is already in it. */
  const [member, setMember] = useState<string | null | false>(null);

  useEffect(() => {
    // While the consent page's return is being finished (`ConsentReturn`),
    // the invitation is its to settle.
    setToken(enabled && consentIntent()?.kind !== "acceptInvite" ? pendingInvite() : null);
  }, [enabled]);

  // The workspace picker waits while this is on screen (`invitationInFlight`).
  useEffect(() => {
    setInvitePromptOpen(token !== null);
    return () => setInvitePromptOpen(false);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const org = pendingInviteOrg();
    if (!org) {
      setMember(false);
      return;
    }
    let live = true;
    setMember(null);
    myOrgs()
      .then((orgs) => {
        if (!live) return;
        if (orgs.some((o) => o.orgId === org)) {
          dropInvite();
          setMember(org);
        } else setMember(false);
      })
      // Cannot tell: ask, as before.
      .catch(() => live && setMember(false));
    return () => {
      live = false;
    };
  }, [token]);

  if (!token || member === null) return null;

  const close = () => {
    setToken(null);
    setError("");
    setSpent(false);
  };

  const dismiss = () => {
    dropInvite();
    close();
  };

  const enter = (groupId: string, memberIdentity: string) => {
    const name = getMessengerDisplayName(groupId);
    if (name) enterWorkspace(api.current, groupId, name, memberIdentity);
    else enterJoinedWorkspaceForName(groupId);
  };

  if (member) {
    return (
      <BaseModal
        toggle={<span />}
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        content={
          <Container>
            <Title>You're already in this workspace</Title>
            <Message>
              This account is already a member, so there is nothing to accept. The link is left unused for the
              person it was meant for.
            </Message>
            <Actions>
              <Button onClick={close}>Close</Button>
              <Button $primary onClick={() => enter(member, getAccountId())}>
                Open workspace
              </Button>
            </Actions>
          </Container>
        }
      />
    );
  }

  const join = async () => {
    setBusy(true);
    setError("");
    // A session opened on Chat's frontend may not redeem an invite
    // (core#4934): the node's consent page does, with the person's passkey,
    // and `ConsentReturn` enters the workspace when it sends them back. The
    // token stays where it is until then, so a decline leaves Join on offer.
    if (await frontendBound().catch(() => false)) {
      const intent = { kind: "acceptInvite" as const, org: pendingInviteOrg() };
      const went = await askOnConsentPage(intent, consentRequest(intent, { inviteToken: token })).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not open the approval page");
        return false;
      });
      if (!went) setBusy(false);
      return;
    }
    const res = await api.current.joinGroup({ invitation: token });
    if (res.error || !res.data) {
      setBusy(false);
      // A refusal (unknown, used, expired, revoked) can never succeed: drop
      // it and say so plainly. Anything else is kept for another try.
      if (inviteRefused(res.error)) {
        dropInvite();
        setSpent(true);
        setError(SPENT_INVITE);
      } else {
        setError(res.error?.message || "This invitation could not be redeemed.");
      }
      return;
    }
    const { groupId, memberIdentity } = res.data;
    dropInvite();
    const meta = await api.current.getGroupMetadata(groupId).catch(() => null);
    const alias = meta?.data?.name?.trim();
    if (alias) setStoredGroupAlias(groupId, alias);
    log.info("InvitationPrompt", `joined workspace ${groupId}`);
    enter(groupId, memberIdentity);
  };

  return (
    <BaseModal
      toggle={<span />}
      open
      onOpenChange={(open) => {
        if (!open && !busy) (spent ? close : dismiss)();
      }}
      content={
        <Container>
          <Title>You're invited to a workspace</Title>
          <Message>Join it to see its channels and message its members in Hyperfeed Chat.</Message>
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Actions>
            <Button onClick={spent ? close : dismiss} disabled={busy}>
              {spent ? "Close" : "Not now"}
            </Button>
            {!spent && (
              <Button $primary onClick={() => void join()} disabled={busy}>
                {busy ? "Joining…" : "Join workspace"}
              </Button>
            )}
          </Actions>
        </Container>
      }
    />
  );
}
