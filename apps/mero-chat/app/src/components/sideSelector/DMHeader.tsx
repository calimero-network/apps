import { styled } from "styled-components";
import StartDMPopup, { type CreateContextResult } from "../popups/StartDMPopup";
import { useCallback } from "react";

const Container = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #0e0e10;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
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
  font-size: 16px;
  font-style: normal;
  font-weight: 700;
  line-height: 150%;
`;
const IconPlusContainer = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  font-size: 1.25rem;
`;

interface DMHeaderProps {
  createDM: (value: string) => Promise<CreateContextResult>;
  chatMembers: Map<string, string>;
}

export default function DMHeader({ createDM, chatMembers }: DMHeaderProps) {
  const isValidIdentityId = useCallback((value: string) => {
    // Check if the value exists in chatMembers values
    const userEntries = chatMembers instanceof Map ? Array.from(chatMembers.entries()) : Object.entries(chatMembers);
    // @ts-expect-error chatMembers is a Map or an object
    const usernames = userEntries.map(([_, username]) => username.toLowerCase());
    const isMember = usernames.includes(value.toLowerCase());

    if (!isMember) {
      return {
        isValid: false,
        error: "User not member of this chat"
      };
    }

    return {
      isValid: true,
      error: ""
    };
  }, [chatMembers]);
  
  return (
    <Container>
      <TextBold>{"Direct Messages"}</TextBold>
      <StartDMPopup
        title="Create a new private DM context"
        placeholder="invite user by entering their name"
        buttonText="Next"
        colors={{
          base: "#5765f2",
          hover: "#717cf0",
          disabled: "#3B487A",
        }}
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
}
