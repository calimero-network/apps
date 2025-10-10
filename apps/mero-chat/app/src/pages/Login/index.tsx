import {
  CalimeroConnectButton,
  useCalimero,
} from "@calimero-network/calimero-client";
import { styled } from "styled-components";
import TabbedInterface from "../../components/contextOperations/TabbedInterface";
import { LogoutWrapper } from "../Context";
import { Button } from "@calimero-network/mero-ui";
import {
  clearDmContextId,
  clearStoredSession,
  clearSessionActivity,
} from "../../utils/session";

export const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0e0e10;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
`;

export const Card = styled.div`
  background: transparent;
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 2rem;
  border-radius: 20px;
  box-shadow:
    0 25px 50px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  width: 90%;
  max-width: 600px;
  position: relative;
  z-index: 1;

  @media (max-width: 768px) {
    padding: 1.5rem;
    width: 95%;
    max-width: 500px;
  }
`;

export const Title = styled.h1`
  text-align: center;
  color: #ffffff;
  margin-bottom: 1.5rem;
  font-size: 2rem;
  font-weight: 600;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  white-space: nowrap;

  @media (max-width: 768px) {
    font-size: 1.7rem;
    margin-bottom: 1rem;
  }
`;

export const ConnectWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  text-align: center;
`;

export const Subtitle = styled.h2`
  text-align: center;
  color: #b8b8d1;
  margin-bottom: 1.5rem;
  font-size: 1.1rem;
  font-weight: 400;
  line-height: 1.6;
  opacity: 0.9;
`;

interface LoginProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
}

export default function Login({ isAuthenticated, isConfigSet }: LoginProps) {
  const { logout } = useCalimero();
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "join-context", label: "Join Context" },
    { id: "invite-to-context", label: "Invite to Context" },
    { id: "create-identity", label: "Create Identity" },
  ];

  const handleLogout = () => {
    clearStoredSession();
    clearDmContextId();
    clearSessionActivity();
    logout();
  };

  return (
    <Wrapper>
      <Card>
        <Title>Welcome to Calimero Chat</Title>
        {!isAuthenticated && !isConfigSet ? (
          <ConnectWrapper>
            <Subtitle>Connect your Node to get started</Subtitle>
            <CalimeroConnectButton />
          </ConnectWrapper>
        ) : (
          <TabbedInterface
            tabs={tabs}
            isAuthenticated={isAuthenticated}
            isConfigSet={isConfigSet}
          />
        )}
        {isAuthenticated && (
          <LogoutWrapper>
            <Button onClick={handleLogout} variant="secondary">Logout</Button>
          </LogoutWrapper>
        )}
      </Card>
    </Wrapper>
  );
}
