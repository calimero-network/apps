import { styled } from "styled-components";
import StartDMPopup, { type CreateContextResult } from "../popups/StartDMPopup";
import { useCallback } from "react";
import type { UserId } from "../../api/clientApi";
import { validateUserId } from "../../utils/validation";

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
  chatMembers: UserId[];
}

export default function DMHeader({ createDM, chatMembers }: DMHeaderProps) {
  const isValidIdentityId = useCallback((value: string) => {
    return validateUserId(value);
  }, []);
  return (
    <Container>
      <TextBold>{"Direct Messages"}</TextBold>
      <StartDMPopup
        title="Create a new private DM context"
        placeholder="invite user by entering their identity ID"
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
