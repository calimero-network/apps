import React from "react";
import styled from "styled-components";

interface TabSwitchProps {
  selectedTabIndex: number;
  setSelectedTabIndex: (index: number) => void;
  userCount: number;
}

const Popup = styled.div`
  display: flex;
  align-items: center;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  padding-top: 1rem;
  border-bottom: solid 1px #282933;
  margin-bottom: 1rem;
`;

const SwitchOption = styled.div<{ selected?: boolean; leftPadding?: boolean }>`
  display: flex;
  column-gap: 0.5rem;
  padding-right: 1rem;
  ${({ leftPadding }) => leftPadding && "padding-left: 1rem;"}
  cursor: pointer;
  ${({ selected }) => (selected ? "color: #5765F2" : "color: #fff;")}
`;

const TabSwitch: React.FC<TabSwitchProps> = (props) => {
  const selectedTabIndex = props.selectedTabIndex ?? 0;
  const setSelectedTabIndex = props.setSelectedTabIndex;
  const userCount = props.userCount ?? 0;

  const items = [
    {
      name: "About",
      icon: "bi bi-info-circle-fill",
    },
    {
      name: `Members ${userCount}`,
      icon: "bi bi-people-fill",
    },
  ];

  return (
    <Popup>
      {items.map((item, index) => (
        <SwitchOption
          key={index}
          selected={selectedTabIndex === index}
          onClick={() => setSelectedTabIndex(index)}
        >
          <i className={item.icon}></i>
          <p>{item.name}</p>
        </SwitchOption>
      ))}
    </Popup>
  );
};

export default TabSwitch;
