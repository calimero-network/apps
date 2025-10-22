import { styled } from "styled-components";
import StartDMPopup, { type CreateContextResult } from "../popups/StartDMPopup";
import { useCallback, memo } from "react";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) =>
    props.$isCollapsed ? "center" : "space-between"};
  align-items: center;
  background-color: #0e0e10;
  padding-bottom: 0.375rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  color: #777583;
  :hover {
    color: #ffffff;
  }
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const TextBold = styled.div`
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 700;
  line-height: 150%;
`;
const IconPlusContainer = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  font-size: 1.125rem;
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
      // Check if the value exists in chatMembers values
      const userEntries =
        chatMembers instanceof Map
          ? Array.from(chatMembers.entries())
          : Object.entries(chatMembers);
      const usernames = userEntries.map(([_, username]) =>
        (username as string).toLowerCase(),
      );
      const isMember = usernames.includes(value.toLowerCase());

      if (!isMember) {
        return {
          isValid: false,
          error: "User not member of this chat",
        };
      }

      return {
        isValid: true,
        error: "",
      };
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
          <IconPlusContainer>
            <i className="bi bi-plus-circle" />
          </IconPlusContainer>
        }
        chatMembers={chatMembers}
        validator={isValidIdentityId}
        functionLoader={createDM}
      />
    </Container>
  );
});

export default DMHeader;
