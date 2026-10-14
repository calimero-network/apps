import { useEffect, useState } from "react";
import styled from "styled-components";

import type { AccountData } from "../types/curbTypes";

import UserProfileIcon from "./ProfileIcon/UserProfileIcon";

const AutocompleteWrapper = styled.div`
  flex-grow: 1;
  width: 100%;
  height: auto;
  max-height: 156px;
  position: absolute;
  z-index: 60;
  margin-bottom: 4px;
  background-color: var(--glass-surface-solid);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  left: 0px;
  padding-top: 6px;
  padding-bottom: 6px;
  padding-left: 12px;
  padding-right: 12px;
  color: var(--glass-ink);
  overflow-y: scroll;

  .listItem {
    display: flex;
    align-items: center;
    padding: 3px;
    cursor: pointer;
    border-radius: 12px;
    width: 100%;
  }
  .accountIdText {
    color: var(--glass-muted);
    font-family: var(--glass-font);
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
  }
  .accountInfo {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--glass-ink);
    font-family: var(--glass-font);
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
  }
  .profileIcon {
    height: 24px;
    width: 24px;
    border-radius: 100%;
    background-color: red;
  }
`;

export const POPUP_POSITION_SWITCH_HEIGHT = 300;

interface AutocompleteListProps {
  onSelect: (accountId: string) => void;
  autocompleteAccounts: AccountData[];
  getIconFromCache: (accountId: string) => Promise<string | null>;
}

function AutocompleteList({
  onSelect,
  autocompleteAccounts,
  getIconFromCache,
}: AutocompleteListProps) {
  const onResultClick = (id: string) => {
    onSelect(id);
  };

  const [elementHoverTop, setElementHoverTop] = useState(true);

  useEffect(() => {
    const element = document.getElementById("wrapper");
    if (element) {
      const elementPosition = element.getBoundingClientRect();
      if (elementPosition.top < POPUP_POSITION_SWITCH_HEIGHT) {
        setElementHoverTop(false);
      } else {
        setElementHoverTop(true);
      }
    }
  }, []);

  return (
    <AutocompleteWrapper
      id="wrapper"
      style={elementHoverTop ? { bottom: "100%" } : { top: "100%" }}
    >
      {autocompleteAccounts.map((account, id) => (
        <div
          className="listItem"
          onClick={() => onResultClick(account.id)}
          key={id}
        >
          <div className="accountInfo">
            <UserProfileIcon
              accountId={account.id}
              getIconFromCache={getIconFromCache}
              showStatus={false}
              width={"32px"}
              height={"32px"}
              active={account.active}
            />
            <span>{account.id}</span>
          </div>
        </div>
      ))}
    </AutocompleteWrapper>
  );
}

export default AutocompleteList;
