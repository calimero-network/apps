import { useState } from "react";

import { TabPanel, Tabs } from "@calimero-network/mero-ui";
import JoinContextTab from "./JoinContextTab";
import CreateIdentityTab from "./CreateIdentityTab";
import InviteToContextTab from "./InviteToContextTab";
import NotificationSettings from "../settings/NotificationSettings";
import ContextSwitcher from "../settings/ContextSwitcher";
import ChatTab from "./ChatTab";

interface TabbedInterfaceProps {
  tabs: { id: string; label: string }[];
  isAuthenticated?: boolean;
  isConfigSet?: boolean;
}

export default function TabbedInterface({ tabs, isAuthenticated, isConfigSet }: TabbedInterfaceProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  

  return (
    <>
      <Tabs tabs={tabs} value={activeTab} onValueChange={setActiveTab} style={{ justifyContent: "center", display: "flex" }} />
      <TabPanel when="join-context" active={activeTab}>
        <JoinContextTab />
      </TabPanel>
      <TabPanel when="invite-to-context" active={activeTab}>
        <InviteToContextTab />
      </TabPanel>
      <TabPanel when="create-identity" active={activeTab}>
        <CreateIdentityTab />
      </TabPanel>
      <TabPanel when="notification-settings" active={activeTab}>
        <NotificationSettings />
      </TabPanel>
      <TabPanel when="context-switcher" active={activeTab}>
        <ContextSwitcher />
      </TabPanel>
      <TabPanel when="chat" active={activeTab}>
        <ChatTab isAuthenticated={isAuthenticated || false} isConfigSet={isConfigSet || false} />
      </TabPanel>
    </>
  );
}
