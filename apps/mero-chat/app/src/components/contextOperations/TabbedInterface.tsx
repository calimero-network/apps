import { useState } from "react";

import { TabPanel, Tabs } from "@calimero-network/mero-ui";
import CreateIdentityTab from "./CreateIdentityTab";
import NotificationSettings from "../settings/NotificationSettings";
import ContextSwitcher from "../settings/ContextSwitcher";
import ChatTab from "./ChatTab";

interface TabbedInterfaceProps {
  tabs: { id: string; label: string }[];
  isAuthenticated?: boolean;
  isConfigSet?: boolean;
  onInvitationSaved?: () => void;
}

export default function TabbedInterface({
  tabs,
  isAuthenticated,
  isConfigSet,
  onInvitationSaved: _onInvitationSaved,
}: TabbedInterfaceProps) {
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  return (
    <>
      <Tabs
        tabs={tabs}
        value={activeTab}
        onValueChange={setActiveTab}
        style={{ justifyContent: "center", display: "flex" }}
      />
      {/* The per-context open-invitation tabs (invite / join by open
          invitation) are gone: they posted to legacy `/admin-api/contexts/
          *_by_open_invitation` routes with a node token, which core removed
          with the groups-only model and which no session can reach now.
          Workspace invitations are namespace invitations, minted and redeemed
          through the session admin in `GroupApiDataSource`. */}
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
        <ChatTab
          isAuthenticated={isAuthenticated || false}
          isConfigSet={isConfigSet || false}
        />
      </TabPanel>
    </>
  );
}
