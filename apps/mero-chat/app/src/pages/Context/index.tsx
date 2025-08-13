import TabbedInterface from "../../components/contextOperations/TabbedInterface";
import {
  CreateIdentityTab,
  InviteToContextTab,
  JoinContextTab,
} from "../../components/contextOperations";
import { Card, Title, Wrapper } from "../Login";
import { useNavigate } from "react-router-dom";
import { styled } from "styled-components";

const BackButton = styled.button`
  background: transparent;
  border: none;
  color: #b8b8d1;
  padding: 0.75rem 1.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 1rem;

`;

export default function Context() {
  const navigate = useNavigate();
  const tabs = [
    { name: "Join Context", component: <JoinContextTab /> },
    { name: "Invite to Context", component: <InviteToContextTab /> },
    { name: "Create Identity", component: <CreateIdentityTab /> },
  ];
  return (
    <Wrapper>
      <Card>
      <BackButton onClick={() => navigate("/")}>
          ← Back
        </BackButton>
        <Title>Context Operations</Title>
        <TabbedInterface tabs={tabs} />
      </Card>
    </Wrapper>
  );
}
