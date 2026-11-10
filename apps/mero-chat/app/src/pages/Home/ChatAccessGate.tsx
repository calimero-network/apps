import { useEffect, useState, type ReactNode } from "react";
import styled from "styled-components";

import { chatAccessIn, type ChatAccess } from "../../api/platform";
import { clearWorkspaceSelection, getGroupId } from "../../constants/config";
import { clearNamespaceReady } from "../../utils/session";
import { nodeBasename } from "../../utils/servedByNode";

/** How often an open workspace re-asks whether Chat is still the account's there. */
const POLL_MS = 30_000;

/**
 * Whether the signed-in account still has Chat in the selected workspace
 * ({@link chatAccessIn}): read on open, when the window regains focus, and
 * every {@link POLL_MS}. `null` until the first answer.
 */
function useChatAccess(groupId: string | null): ChatAccess | null {
  const [access, setAccess] = useState<ChatAccess | null>(null);
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    const check = () => {
      void chatAccessIn(groupId).then((next) => {
        if (!cancelled) setAccess(next);
      });
    };
    check();
    const interval = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [groupId]);
  return access;
}

/**
 * The selected workspace, unless the account no longer has Chat there: taken
 * off chat's app team (Calimero Home's Remove, or Chat's own), or left without
 * a row when an admin kept the org's apps apart. The workspace shell would
 * then load with no channels and no people; this says what happened instead
 * and offers the workspace picker. Until the first answer, and whenever the
 * answer says nothing about Chat (the org could not be read), the workspace
 * renders as before: the membership watch inside it handles a removal from
 * the org.
 */
export default function ChatAccessGate({ children }: { children: ReactNode }) {
  const access = useChatAccess(getGroupId());
  if (access?.kind !== "closed") return <>{children}</>;
  return <NoChatAccess orgName={access.orgName} />;
}

function NoChatAccess({ orgName }: { orgName: string }) {
  const pick = () => {
    // A real navigation, as every bounce out of Home is (see Home's guard).
    clearWorkspaceSelection();
    clearNamespaceReady();
    window.location.replace(nodeBasename() + "login");
  };
  return (
    <Page>
      <Card role="alert" data-testid="no-chat-access">
        <Title>{`You no longer have access to Chat in ${orgName}`}</Title>
        <Sub>
          An admin took you out of Chat there, or keeps the organization&apos;s apps apart and has
          not added you to Chat. You are still in {orgName} and its other apps; ask an admin to add
          you back to Chat.
        </Sub>
        <Primary type="button" onClick={pick}>
          Choose another workspace
        </Primary>
      </Card>
    </Page>
  );
}

const Page = styled.main`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
`;

const Card = styled.section`
  background: var(--glass-surface-solid);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  border-radius: 16px;
  padding: 2rem;
  width: 100%;
  max-width: 440px;
  box-shadow: var(--chat-dialog-shadow);
`;

const Title = styled.h1`
  color: var(--glass-ink);
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  letter-spacing: -0.02em;
`;

const Sub = styled.p`
  color: color-mix(in srgb, var(--glass-ink) 55%, transparent);
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
  line-height: 1.55;
`;

const Primary = styled.button`
  width: 100%;
  padding: 0.7rem 1rem;
  border-radius: 999px;
  border: none;
  background: var(--glass-accent-solid, var(--glass-accent));
  color: var(--glass-on-accent, #fff);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
`;
