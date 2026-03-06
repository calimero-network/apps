import { styled } from "styled-components";
import StartDMPopup, { type CreateContextResult } from "../popups/StartDMPopup";
import { useCallback, memo } from "react";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.25rem 0.75rem 0.25rem ${(props) => (props.$isCollapsed ? "0.75rem" : "1rem")};
  margin-bottom: 0.125rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const TextBold = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
`;

const PlusButton = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.25);
  transition: all 0.15s ease;

  &:hover {
    color: #a5ff11;
    background: rgba(165, 255, 17, 0.1);
  }

  svg {
    stroke: currentColor;
  }
`;

interface DMHeaderProps {
  createDM: (value: string) => Promise<CreateContextResult>;
  chatMembers: Map<string, string>;
  isCollapsed?: boolean;
}

const DMHeader = memo(function DMHeader({
  createDM,
  chatMembers,
  isCollapsed,
}: DMHeaderProps) {
  const isValidIdentityId = useCallback(
    (value: string) => {
      const userEntries =
        chatMembers instanceof Map
          ? Array.from(chatMembers.entries())
          : Object.entries(chatMembers);
      const usernames = userEntries.map(([_, username]) =>
        (username as string).toLowerCase(),
      );
      const isMember = usernames.includes(value.toLowerCase());

      if (!isMember) {
        return { isValid: false, error: "User not member of this chat" };
      }
      return { isValid: true, error: "" };
    },
    [chatMembers],
  );

  return (
    <Container $isCollapsed={isCollapsed}>
      {!isCollapsed && <TextBold>{"Direct Messages"}</TextBold>}
      <StartDMPopup
        title="Create a new private DM context"
        placeholder="invite user by entering their name"
        buttonText="Next"
        toggle={
          <PlusButton>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </PlusButton>
        }
        chatMembers={chatMembers}
        validator={isValidIdentityId}
        functionLoader={createDM}
      />
    </Container>
  );
});

export default DMHeader;
