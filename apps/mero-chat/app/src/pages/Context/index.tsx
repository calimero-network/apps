import TabbedInterface from "../../components/contextOperations/TabbedInterface";
import { Card, Title, Wrapper } from "../Login";
import { useNavigate } from "react-router-dom";
import { styled } from "styled-components";
import { useCalimero } from "@calimero-network/calimero-client";
import {
  clearDmContextId,
  clearStoredSession,
  clearSessionActivity,
} from "../../utils/session";
import { Button } from "@calimero-network/mero-ui";

const BackButton = styled.button`
  background: transparent;
  border: none;
  color: #b8b8d1;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  margin-bottom: 1rem;
`;

export const LogoutWrapper = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 1rem;
`;

export const BackButtonWrapper = styled.div`
  display: flex;
  justify-content: flex-start;
  width: 100%;
`

export default function Context() {
  const navigate = useNavigate();
  const { logout } = useCalimero();

  const handleLogout = () => {
    clearStoredSession();
    clearDmContextId();
    clearSessionActivity();
    logout();
  };

  const tabs = [
    { id: "join-context", label: "Join Context" },
    { id: "invite-to-context", label: "Invite to Context" },
    { id: "create-identity", label: "Create Identity" },
    { id: "notification-settings", label: "Notification Settings" },
  ];
  return (
    <Wrapper>
      <Card>
        <BackButtonWrapper>
        <BackButton onClick={() => navigate("/")}>← Back</BackButton>
        </BackButtonWrapper>
        
        <Title>Context Operations</Title>
        <TabbedInterface tabs={tabs} />
        <LogoutWrapper>
        <Button onClick={handleLogout} variant="secondary" style={{ width: "80px" }}>Logout</Button>
        </LogoutWrapper>
      </Card>
    </Wrapper>
  );
}
