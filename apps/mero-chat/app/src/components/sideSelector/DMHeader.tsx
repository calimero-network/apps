import { styled } from "styled-components";
import StartDMPopup from "../popups/StartDMPopup";
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
  createDM: (value: string) => Promise<void>;
}

export default function DMHeader({ createDM }: DMHeaderProps) {
  const isValidNearAccount = useCallback((value: string) => {
    const regex = /^[a-z\d]+[-_]*[a-z\d]+[-_]*[a-z\d]+\.(near|testnet)$/;
    let isValid = false;
    let error = "";

    if (!regex.test(value)) {
      isValid = false;
      error = "Invite users whose wallets end with '.near' for access";
    } else {
      isValid = true;
      error = "";
    }
    return { isValid, error };
  }, []);
  return (
    <Container>
      <TextBold>{"Direct Messages"}</TextBold>
      <StartDMPopup
        title="Start new message"
        placeholder="Send to wallet address"
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
        onAccountSelected={createDM}
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fetchAccounts={(prefix) => {
          // TODO: Implement fetchAccounts
          //return curbApi.fetchAccounts({ prefix, limit: 20 });
          return Promise.resolve([]);
        }}
        validator={isValidNearAccount}
        functionLoader={createDM}
      />
    </Container>
  );
}
