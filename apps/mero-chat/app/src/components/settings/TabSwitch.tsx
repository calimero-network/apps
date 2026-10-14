import React from "react";
import styled from "styled-components";

interface TabSwitchProps {
  selectedTabIndex: number;
  setSelectedTabIndex: (index: number) => void;
  userCount: number;
}

const TabBar = styled.div`
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
  margin-bottom: 1rem;
  gap: 0.25rem;
`;

const SwitchOption = styled.button<{ $selected?: boolean }>`
  background: none;
  border: none;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: ${({ $selected }) => ($selected ? "600" : "400")};
  color: ${({ $selected }) => ($selected ? "var(--glass-accent)" : "color-mix(in srgb, var(--glass-ink) 45%, transparent)")};
  position: relative;
  transition: color 0.15s ease;
  white-space: nowrap;

  &::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: 1px 1px 0 0;
    background: ${({ $selected }) => ($selected ? "var(--glass-ink)" : "transparent")};
    transition: background 0.15s ease;
  }

  &:hover {
    color: ${({ $selected }) => ($selected ? "var(--glass-accent)" : "color-mix(in srgb, var(--glass-ink) 70%, transparent)")};
  }
`;

const TabSwitch: React.FC<TabSwitchProps> = (props) => {
  const selectedTabIndex = props.selectedTabIndex ?? 0;
  const setSelectedTabIndex = props.setSelectedTabIndex;
  const userCount = props.userCount ?? 0;

  const items = ["About", `Members (${userCount})`];

  return (
    <TabBar>
      {items.map((name, index) => (
        <SwitchOption
          key={index}
          $selected={selectedTabIndex === index}
          onClick={() => setSelectedTabIndex(index)}
        >
          {name}
        </SwitchOption>
      ))}
    </TabBar>
  );
};

export default TabSwitch;
