import React, { useState } from "react";
import styled from "styled-components";
import BaseModal from "./BaseModal";
import Loader from "../../loader/Loader";
import { Avatar } from "@calimero-network/mero-ui";
import type { UserId } from "../../../api/clientApi";

interface MultipleInputPopupProps {
  title: string;
  toggle: React.ReactNode;
  placeholder: string;
  functionLoader: () => void;
  buttonText: string;
  colors: {
    base: string;
    hover: string;
    disabled: string;
  };
  isChild?: boolean;
  autocomplete?: boolean;
  nonInvitedUserList: UserId[];
  selectedUsers: string[];
  setSelectedUsers: (users: string[]) => void;
  updateUsers: (value: string) => void;
}

const Text = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  margin-bottom: 1rem;
`;

const Input = styled.input`
  position: relative;
  width: 100%;
  color: #fff;
  height: 40px;
  padding: 8px 60px 8px 16px;
  border-radius: 4px;
  background-color: #0e0e10;
  border: none;
  outline: 0;
  box-sizing: border-box;
  :focus {
    border: none;
    outline: 0;
  }
`;

const FunctionButton = styled.button<{
  $disabled: boolean;
  $colors: { base: string; hover: string; disabled: string };
}>`
  background-color: ${({ $disabled, $colors }) =>
    $disabled ? $colors.disabled : $colors.base};
  :hover {
    background-color: ${({ $disabled, $colors }) =>
      $disabled ? $colors.disabled : $colors.hover};
  }
  color: #fff;
  border-radius: 4px;
  margin-top: 4px;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border: none;
  width: 100%;
`;

const CloseButton = styled.div`
  color: #fff;
  :hover {
    color: #5765f2;
  }
  position: absolute;
  right: 1rem;
  cursor: pointer;
`;

const UserList = styled.div`
  position: absolute;
  overflow-y: scroll;
  max-height: 150px;
  width: 100%;
  background-color: #1d1d21;
  border-radius: 4px;
  padding: 8px;
  scrollbar-color: black black;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  html::-webkit-scrollbar {
    width: 12px;
  }
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;

const UserListItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #777583;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  :hover {
    background-color: #25252a;
  }
`;

const UserInfo = styled.div`
  display: flex;
  column-gap: 0.5rem;
`;

const UserText = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  width: 100%;
`;

const RulesWrapper = styled.div`
  color: #6c757d;
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 21px */
  margin-top: 6px;
`;

const InputWrapper = styled.div`
  position: relative;
  box-sizing: border-box;
  width: 100%;
`;

const SelectedAccountsWrapper = styled.div`
  padding: 8px;
  margin-top: 16px;
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
  background-color: #0e0e10;
  border: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;

  .selectedItem {
    background-color: #1d1d21;
    padding: 4px 8px;
    border-radius: 4px;
    display: flex;
    width: fit-content;
    color: #fff;
  }
  .accountName {
    margin-right: 8px;
  }

  .removeButton {
    z-index: 20;
    cursor: pointer;
  }
`;

interface AutocompleteContainerProps {
  value: string;
  inviteUsers: UserId[];
  selectUser: (userId: string) => void;
  selectedUsers: string[];
}

const AutocompleteContainer: React.FC<AutocompleteContainerProps> = ({
  value,
  inviteUsers,
  selectUser,
  selectedUsers,
}) => {
  const filteredInviteUsers = Object.values(inviteUsers).filter(
    (user) => user !== value && !selectedUsers.includes(user)
  );
  return (
    <>
      {filteredInviteUsers.length > 0 && (
        <UserList>
          {filteredInviteUsers.map((user, id) => (
            <UserListItem key={id} onClick={() => selectUser(user)}>
              <UserInfo>
                <Avatar size="xs" name={user} />
                <UserText>{user}</UserText>
              </UserInfo>
            </UserListItem>
          ))}
        </UserList>
      )}
    </>
  );
};

const MultipleInputPopup: React.FC<MultipleInputPopupProps> = (props) => {
  const {
    title,
    toggle,
    placeholder,
    functionLoader,
    buttonText,
    colors,
    isChild,
    autocomplete,
    nonInvitedUserList,
    selectedUsers,
    setSelectedUsers,
    updateUsers,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [invitationsInProgress, setInvitationsInProgress] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const isAutocompleteListOpen =
    autocomplete &&
    inputValue &&
    nonInvitedUserList && Object.keys(nonInvitedUserList).length > 0 &&
    showAutocomplete;

  const selectUser = (userId: string) => {
    const updatedList = [...selectedUsers, userId];
    setSelectedUsers(updatedList);
    setInputValue("");
    setShowAutocomplete(false);
  };

  const customStyle: React.CSSProperties = {
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
  };

  if (selectedUsers.length === 0) {
    customStyle.marginTop = "16px";
    customStyle.borderTopLeftRadius = "4px";
    customStyle.borderTopRightRadius = "4px";
  } else {
    customStyle.marginTop = "0px";
    customStyle.borderTopLeftRadius = "0px";
    customStyle.borderTopRightRadius = "0px";
  }

  const unselectUser = (accountId: string) => {
    const filteredArray = selectedUsers.filter(
      (itemId) => itemId !== accountId
    );
    setSelectedUsers(filteredArray);
  };

  const runProcess = () => {
    setInvitationsInProgress(true);
    functionLoader();
    setInvitationsInProgress(false);
    setIsOpen(false);
  };

  const onOpenChange = (isOpen: boolean) => {
    if (invitationsInProgress && !isOpen) {
      return;
    }
    setIsOpen(isOpen);
  };

  const handleClosePopup = () => {
    if (invitationsInProgress) return;
    setIsOpen(false);
  };

  const popupContent = (
    <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <CloseButton onClick={handleClosePopup}>
        <i className="bi bi-x-lg"></i>
      </CloseButton>
      <Text>{title}</Text>
      <InputWrapper>
        {selectedUsers.length > 0 && (
          <SelectedAccountsWrapper>
            {selectedUsers.map((accountId, id) => (
              <div className="selectedItem" key={id}>
                <span className="accountName">{accountId}</span>
                <div
                  className="removeButton"
                  onClick={() => unselectUser(accountId)}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="#fff"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_972_45209)">
                      <path
                        d="M12 6C12 7.5913 11.3679 9.11742 10.2426 10.2426C9.11742 11.3679 7.5913 12 6 12C4.4087 12 2.88258 11.3679 1.75736 10.2426C0.632141 9.11742 0 7.5913 0 6C0 4.4087 0.632141 2.88258 1.75736 1.75736C2.88258 0.632141 4.4087 0 6 0C7.5913 0 9.11742 0.632141 10.2426 1.75736C11.3679 2.88258 12 4.4087 12 6ZM4.0155 3.4845C3.94509 3.41408 3.84958 3.37453 3.75 3.37453C3.65042 3.37453 3.55491 3.41408 3.4845 3.4845C3.41408 3.55491 3.37453 3.65042 3.37453 3.75C3.37453 3.84958 3.41408 3.94509 3.4845 4.0155L5.46975 6L3.4845 7.9845C3.44963 8.01937 3.42198 8.06076 3.40311 8.10631C3.38424 8.15187 3.37453 8.20069 3.37453 8.25C3.37453 8.29931 3.38424 8.34813 3.40311 8.39369C3.42198 8.43924 3.44963 8.48063 3.4845 8.5155C3.55491 8.58591 3.65042 8.62547 3.75 8.62547C3.79931 8.62547 3.84813 8.61576 3.89369 8.59689C3.93924 8.57802 3.98063 8.55037 4.0155 8.5155L6 6.53025L7.9845 8.5155C8.01937 8.55037 8.06076 8.57802 8.10631 8.59689C8.15187 8.61576 8.20069 8.62547 8.25 8.62547C8.29931 8.62547 8.34813 8.61576 8.39369 8.59689C8.43924 8.57802 8.48063 8.55037 8.5155 8.5155C8.55037 8.48063 8.57802 8.43924 8.59689 8.39369C8.61576 8.34813 8.62547 8.29931 8.62547 8.25C8.62547 8.20069 8.61576 8.15187 8.59689 8.10631C8.57802 8.06076 8.55037 8.01937 8.5155 7.9845L6.53025 6L8.5155 4.0155C8.55037 3.98063 8.57802 3.93924 8.59689 3.89369C8.61576 3.84813 8.62547 3.79931 8.62547 3.75C8.62547 3.70069 8.61576 3.65187 8.59689 3.60631C8.57802 3.56076 8.55037 3.51937 8.5155 3.4845C8.48063 3.44963 8.43924 3.42198 8.39369 3.40311C8.34813 3.38424 8.29931 3.37453 8.25 3.37453C8.20069 3.37453 8.15187 3.38424 8.10631 3.40311C8.06076 3.42198 8.01937 3.44963 7.9845 3.4845L6 5.46975L4.0155 3.4845Z"
                        fill="white"
                      />
                    </g>
                    <defs>
                      <clipPath id="clip0_972_45209">
                        <rect width="12" height="12" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </div>
              </div>
            ))}
          </SelectedAccountsWrapper>
        )}
        <Input
          onChange={(e) => {
            setInputValue(e.target.value);
            updateUsers(e.target.value);
            if (e.target.value) {
              setShowAutocomplete(true);
            } else {
              setShowAutocomplete(false);
            }
          }}
          value={inputValue}
          placeholder={placeholder}
          style={customStyle}
        />
        {isAutocompleteListOpen && (
          <AutocompleteContainer
            value={inputValue}
            inviteUsers={nonInvitedUserList}
            selectUser={selectUser}
            selectedUsers={selectedUsers}
          />
        )}
      </InputWrapper>
      <RulesWrapper>
        Invite users to group
      </RulesWrapper>
      <FunctionButton
        onClick={runProcess}
        $disabled={selectedUsers.length === 0}
        $colors={colors}
      >
        {invitationsInProgress ? <Loader size={16} /> : buttonText}
      </FunctionButton>
    </div>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={onOpenChange}
      isChild={isChild}
    />
  );
};

export default MultipleInputPopup;
