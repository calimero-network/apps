import { useEffect, useRef, useState } from "react";
import { styled } from "styled-components";

import BaseModal from "../common/popups/BaseModal";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { setStoredGroupAlias } from "../../constants/config";
import { lastUsedName } from "@calimero-apps/names";
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
 * An opened invitation link, once the person is signed in: one step. They see
 * the invitation, choose their name in the workspace (offered: the one they
 * last used) and press Join. Join redeems the token (on the node's consent
 * page when the session is bound to Chat's frontend, see `ConsentReturn`),
 * publishes the name as their member metadata, and opens #general.
 *
 * The token was taken off the address bar before React mounted
 * (`captureInvite` in `main.tsx`), so it survives the passkey sign-in on the
 * invitation page (`pages/Login/InvitationPage`).
 *
 * Someone already in the workspace is not offered Join: redeeming spends the
 * link's single use. When the link names its workspace (`&org=`) and this
 * account is in it, the token is dropped unspent and they are taken there.
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

const Label = styled.label`
  display: block;
  color: color-mix(in srgb, var(--glass-ink) 70%, transparent);
  font-size: 0.78rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
`;

const NameInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.75rem;
  margin-bottom: 1rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 14%, transparent);
  background: var(--glass-surface-solid);
  color: var(--glass-ink);
  font-size: 0.88rem;
  &:focus {
    outline: none;
    border-color: var(--glass-accent);
  }
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

/** The longest name a member may choose (the contract's old limit, kept). */
const MAX_NAME = 50;

export default function InvitationPrompt({ enabled }: Props) {
  const api = useRef(new GroupApiDataSource());
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [spent, setSpent] = useState(false);
  /** null while it is being checked; the workspace when this account is already in it. */
  const [member, setMember] = useState<string | null | false>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    // While the consent page's return is being finished (`ConsentReturn`),
    // the invitation is its to settle.
    const pending = enabled && consentIntent()?.kind !== "acceptInvite" ? pendingInvite() : null;
    setToken(pending);
    if (pending) setName(getMessengerDisplayName(pendingInviteOrg() ?? "") || lastUsedName());
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
      // Cannot tell: offer Join.
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

  if (member) {
    const open = () => {
      const known = getMessengerDisplayName(member);
      if (known) void enterWorkspace(api.current, member, known, getAccountId());
      else enterJoinedWorkspaceForName(member);
    };
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
            <Message>The link stays unused for the person it was meant for.</Message>
            <Actions>
              <Button onClick={close}>Close</Button>
              <Button $primary onClick={open}>
                Open workspace
              </Button>
            </Actions>
          </Container>
        }
      />
    );
  }

  const chosen = name.trim();

  const join = async () => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    // A session opened on Chat's frontend may not redeem an invite
    // (core#4934): the node's consent page does, with the person's passkey,
    // and `ConsentReturn` publishes the name and enters the workspace when it
    // sends them back. The token stays where it is until then, so a decline
    // leaves Join on offer.
    if (await frontendBound().catch(() => false)) {
      const intent = { kind: "acceptInvite" as const, org: pendingInviteOrg(), selfName: chosen };
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
    await enterWorkspace(api.current, groupId, chosen, memberIdentity);
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
          {!spent && (
            <>
              <Label htmlFor="invite-name">Your name</Label>
              <NameInput
                id="invite-name"
                value={name}
                maxLength={MAX_NAME}
                placeholder="e.g. Alice"
                autoFocus
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void join();
                }}
              />
            </>
          )}
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Actions>
            <Button onClick={spent ? close : dismiss} disabled={busy}>
              {spent ? "Close" : "Not now"}
            </Button>
            {!spent && (
              <Button $primary onClick={() => void join()} disabled={busy || !chosen}>
                {busy ? "Joining…" : "Join"}
              </Button>
            )}
          </Actions>
        </Container>
      }
    />
  );
}
