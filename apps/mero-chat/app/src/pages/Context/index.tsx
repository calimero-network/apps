import TabbedInterface from "../../components/contextOperations/TabbedInterface";
import {
  CreateIdentityTab,
  InviteToContextTab,
  JoinContextTab,
} from "../../components/contextOperations";
import { Card, Title, Wrapper } from "../Login";

export default function Context() {
  const tabs = [
    { name: "Join Context", component: <JoinContextTab /> },
    { name: "Invite to Context", component: <InviteToContextTab /> },
    { name: "Create Identity", component: <CreateIdentityTab /> },
  ];
  return (
    <Wrapper>
      <Card>
        <Title>Context Operations</Title>
        <TabbedInterface tabs={tabs} />
      </Card>
    </Wrapper>
  );
}
