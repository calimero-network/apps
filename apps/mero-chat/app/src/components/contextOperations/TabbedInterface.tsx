import React, { useState } from "react";
import { styled } from "styled-components";
import { useCalimero } from "@calimero-network/calimero-client";
import { clearDmContextId, clearStoredSession } from "../../utils/session";

const TabContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
`;

const TabNavigation = styled.div`
  display: flex;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  gap: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  
  &::-webkit-scrollbar {
    display: none;
  }
`;

const TabButton = styled.button<{ $isActive: boolean }>`
  background: ${({ $isActive }) =>
    $isActive ? "rgba(255, 255, 255, 0.1)" : "transparent"};
  color: ${({ $isActive }) =>
    $isActive ? "#ffffff" : "#b8b8d1"};
  border: none;
  padding: 0.6rem 1.2rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 2px solid ${({ $isActive }) =>
    $isActive ? "#667eea" : "transparent"};
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    background: ${({ $isActive }) =>
      $isActive ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.05)"};
    color: #ffffff;
  }

  @media (max-width: 768px) {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
  }
`;

const TabContent = styled.div`
  min-height: 300px;
`;

const LogoutButton = styled.button`
  background: none;
  color: #e74c3c;
  border: none;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s ease;
  margin-top: 1rem;
  align-self: center;

  &:hover {
    color: #c0392b;
  }
`;

interface TabbedInterfaceProps {
  tabs: { name: string; component: React.ReactNode }[];
}

export default function TabbedInterface({ tabs }: TabbedInterfaceProps) {
  const [activeTab, setActiveTab] = useState(0);
  const { logout } = useCalimero();

  const handleLogout = () => {
    clearStoredSession();
    clearDmContextId();
    logout();
  }

  return (
    <TabContainer>
      <TabNavigation>
        {tabs.map((tab, index) => (
          <TabButton
            key={index}
            $isActive={activeTab === index}
            onClick={() => setActiveTab(index)}
          >
            {tab.name}
          </TabButton>
        ))}
      </TabNavigation>
      
      <TabContent>
        {tabs[activeTab].component}
      </TabContent>

      <LogoutButton onClick={handleLogout}>
        Logout
      </LogoutButton>
    </TabContainer>
  );
}
