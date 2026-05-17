import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import type { User } from "../../types/Common";
import { Avatar, Button, Input } from "@calimero-network/mero-ui";
import type { Role, UserId } from "../../api/clientApi";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import BaseModal from "../common/popups/BaseModal";


const UserListItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.45rem 0.625rem;
  border-radius: 8px;
  cursor: default;
  transition: background 0.12s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const UserList = styled.div`
  overflow-y: auto;
  max-height: 22rem;
  @media (max-width: 1024px) {
    max-height: 12rem;
  }
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
`;

const UserInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
`;

const Text = styled.div<{ $isSelected?: boolean }>`
  font-size: 0.82rem;
  font-weight: 500;
  color: ${({ $isSelected }) => ($isSelected ? "#a5ff11" : "rgba(255,255,255,0.85)")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// const RoleText = styled.div`
//   color: #777583;
//   font-family: Helvetica Neue;
//   font-size: 12px;
//   font-style: normal;
//   font-weight: 700;
//   line-height: 100%;
// `;

// const ModeratorOptions = styled.div`
//   display: flex;
//   justify-content: center;
//   align-items: center;
//   gap: 12px;
// `;

// const OptionsButton = ({ handleClick }: { handleClick: () => void }) => {
//   return (
//     <div onClick={handleClick}>
//       <svg
//         xmlns="http://www.w3.org/2000/svg"
//         width="18"
//         height="18"
//         fill="white"
//         className="bi bi-three-dots"
//         viewBox="0 0 16 16"
//       >
//         <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
//       </svg>
//     </div>
//   );
// };

// const OptionsWindow = styled.div`
//   width: 252px;
//   display: flex;
//   flex-direction: column;
//   padding-top: 4px;
//   padding-bottom: 4px;
//   border-radius: 4px;
//   background-color: #25252a;
//   pointer-events: auto;
// `;

// const Option = styled.div`
//   color: #fff;
//   font-family: Helvetica Neue;
//   font-size: 16px;
//   font-style: normal;
//   padding-left: 1rem;
//   padding-right: 1rem;
//   padding-top: 4px;
//   padding-bottom: 4px;
//   font-weight: 400;
//   line-height: 150%;
//   -webkit-font-smoothing: antialiased applied;
//   cursor: pointer;

//   :hover {
//     background-color: #2a2b37;
//   }
// `;

const RemoveButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
  opacity: 0;

  ${UserListItem}:hover & {
    opacity: 1;
  }

  &:hover {
    background: rgba(255, 80, 80, 0.1);
    color: rgba(255, 100, 100, 0.8);
  }
`;

const AddMemberButton = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(165, 255, 17, 0.06);
    border-color: rgba(165, 255, 17, 0.2);
    color: #a5ff11;
  }
`;

const SuggestionsDropdown = styled.div`
  max-height: 180px;
  overflow-y: auto;
  border-radius: 8px;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  position: absolute;
  top: calc(100% + 4px);
  width: 100%;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
`;

const SuggestionItem = styled.div`
  padding: 0.55rem 0.875rem;
  cursor: pointer;
  font-size: 0.82rem;
  color: #fff;
  transition: background 0.1s ease;
  &:hover { background: rgba(255, 255, 255, 0.06); }
`;

const InviteField = styled.div`
  margin-bottom: 1rem;
  position: relative;
`;

const InviteLabel = styled.div`
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.4rem;
`;

const ModalContent = styled.div`
  min-width: 280px;
  padding: 0.25rem 0;
`;

const ModalTitle = styled.h3`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 1.25rem;
`;

interface AddUserDialogProps {
  addMember: (account: string, channel: string) => void;
  channelName: string;
  nonChannelMembers?: Map<string, string>;
}

const AddUserDialog = ({
  addMember,
  channelName,
  nonChannelMembers,
}: AddUserDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedIdentity, setSelectedIdentity] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const memberOptions = nonChannelMembers
    ? Array.from(nonChannelMembers.entries()).map(([identity, label]) => ({ identity, label }))
    : [];

  const filteredSuggestions = inputValue.trim()
    ? memberOptions.filter(({ identity, label }) => {
        const q = inputValue.toLowerCase();
        return identity.toLowerCase().includes(q) || label.toLowerCase().includes(q);
      })
    : memberOptions;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setSelectedIdentity("");
    setShowSuggestions(true);
  };

  const handleInputContainerClick = () => {
    if (!selectedIdentity) setShowSuggestions(filteredSuggestions.length > 0);
  };

  const handleSuggestionClick = (identity: string, label: string) => {
    setSelectedIdentity(identity);
    // Show the human-readable label in the visible input. Identity stays
    // internal (selectedIdentity), used as the actual add target. Never
    // surface the raw public key in the UI.
    setInputValue(label || "");
    setShowSuggestions(false);
  };

  const handleInvite = useCallback(async () => {
    // Require a real identity from the suggestion list — typing a
    // username and submitting without picking sends the typed string
    // as `identity` to the server, which fails to parse it as a
    // PublicKey and rejects the request.
    if (!selectedIdentity) return;
    setIsProcessing(true);
    addMember(selectedIdentity, channelName);
    setInputValue("");
    setSelectedIdentity("");
    setIsOpen(false);
    setIsProcessing(false);
  }, [selectedIdentity, addMember, channelName]);

  const content = (
    <ModalContent>
      <ModalTitle>Add member to #{channelName}</ModalTitle>
      <InviteField>
        <InviteLabel>Member</InviteLabel>
        <div style={{ position: "relative" }} onClick={handleInputContainerClick}>
          <Input
            value={inputValue}
            placeholder="Search by username..."
            onChange={handleInputChange}
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <SuggestionsDropdown>
              {filteredSuggestions.map((s) => (
                <SuggestionItem
                  key={s.identity}
                  onMouseDown={(e) => { e.preventDefault(); handleSuggestionClick(s.identity, s.label); }}
                >
                  {s.label || "Unnamed member"}
                </SuggestionItem>
              ))}
            </SuggestionsDropdown>
          )}
        </div>
      </InviteField>
      <Button
        type="button"
        variant="primary"
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => void handleInvite()}
        disabled={isProcessing || !selectedIdentity}
      >
        Invite
      </Button>
    </ModalContent>
  );

  return (
    <BaseModal
      toggle={
        <AddMemberButton onClick={() => setIsOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add member
        </AddMemberButton>
      }
      content={content}
      open={isOpen}
      onOpenChange={setIsOpen}
      isChild={true}
    />
  );
};

const OverLay = styled.div`
  position: absolute;
  z-index: 10;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
`;

// const TopOverlay = styled.div<{ bottomPadding: boolean }>`
//   position: fixed;
//   z-index: 20;
//   @media (max-width: 1024px) {
//     position: absolute;
//     right: 0;
//     ${({ bottomPadding }) =>
//       bottomPadding
//         ? `
//       bottom: 100%;
//     `
//         : `
//       top: 100%;
//     `}
//   }
// `;


// const OptionsWrapper = styled.div`
//   position: relative;
// `;

// ── Role badge + action buttons ───────────────────────────────────────────

const RoleBadge = styled.span<{ $role: Role }>`
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 0.25rem;
  ${({ $role }) => {
    switch ($role) {
      case "Admin":
        return `color:#a5ff11; background:rgba(165,255,17,0.12);`;
      case "Mod":
        return `color:#5cd8ff; background:rgba(92,216,255,0.12);`;
      case "Banned":
        return `color:#ff6b6b; background:rgba(255,107,107,0.14);`;
      default:
        return `display:none;`;
    }
  }}
`;

const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
`;

const ActionBtn = styled.button<{ $variant?: "danger" | "default" }>`
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:enabled {
    color: ${({ $variant }) => ($variant === "danger" ? "#ff6b6b" : "#a5ff11")};
    border-color: ${({ $variant }) =>
      $variant === "danger" ? "rgba(255,107,107,0.4)" : "rgba(165,255,17,0.4)"};
    background: ${({ $variant }) =>
      $variant === "danger" ? "rgba(255,107,107,0.08)" : "rgba(165,255,17,0.06)"};
  }

  &:disabled { opacity: 0.35; cursor: not-allowed; }
`;

const HoverRow = styled(UserListItem)`
  &:hover ${RowActions} { opacity: 1; }
`;

// Promote/demote rules: User <-> Mod <-> Admin (single rung at a time).
function promoteTarget(role: Role): Role | null {
  if (role === "User") return "Mod";
  if (role === "Mod") return "Admin";
  return null;
}
function demoteTarget(role: Role): Role | null {
  if (role === "Admin") return "Mod";
  if (role === "Mod") return "User";
  return null;
}

interface MemberDetailsProps {
  id: number;
  user: UserId;
  promoteModerator: (userId: string, isModerator: boolean) => void;
  removeUserFromChannel: (userId: string) => void | Promise<void>;
  channelOwner: string;
  optionsOpen: number;
  setOptionsOpen: (id: number) => void;
  selectedUser: User | null;
  setSelectedUser: (user: User | null) => void;
  userList: Map<string, string>;
  addMember: (account: string, channel: string) => void;
  channelName: string;
  getNonInvitedUsers: (value: string) => UserId[];
  nonInvitedUserList: UserId[];
  nonChannelMembers?: Map<string, string>;
  isOwner?: boolean;
  /// Context (channel) id — required to read/write WASM-level moderation roles.
  contextId?: string;
  /// Viewer's identity within this context. Falsy → no actions are exposed.
  myContextIdentity?: string;
}

const MemberDetails: React.FC<MemberDetailsProps> = (props) => {
  const userList = props.userList;

  const [optionsOpen, setOptionsOpen] = useState(-1);

  // ── In-context roles (WASM moderation) ──────────────────────────────────
  // Empty entry in `roles` ↔ Role::User on the WASM side. We track everyone
  // in `userList` so the UI can show badges and gate actions per row.
  const [roles, setRoles] = useState<Map<string, Role>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    if (!props.contextId || !props.myContextIdentity) return;
    const resp = await new ClientApiDataSource().listRoles({
      contextId: props.contextId,
      executorPublicKey: props.myContextIdentity,
    });
    if (resp.error || !resp.data) return;
    const next = new Map<string, Role>();
    for (const { identity, role } of resp.data) next.set(identity, role);
    setRoles(next);
  }, [props.contextId, props.myContextIdentity]);

  useEffect(() => { void fetchRoles(); }, [fetchRoles]);

  const roleOf = (identity: string): Role => {
    if (roles.has(identity)) return roles.get(identity)!;
    // The creator is seeded as Admin in `init`. Use that as a fallback when
    // `list_roles` hasn't surfaced them (older contexts pre-role-map etc.).
    if (identity === props.channelOwner) return "Admin";
    return "User";
  };

  const myRole = props.myContextIdentity ? roleOf(props.myContextIdentity) : "User";
  const canModerate = myRole === "Admin" || myRole === "Mod";

  const applyRole = async (target: string, role: Role) => {
    if (!props.contextId || !props.myContextIdentity) return;
    setBusy(target);
    try {
      const resp = await new ClientApiDataSource().setMemberRole({
        contextId: props.contextId,
        executorPublicKey: props.myContextIdentity,
        target,
        role,
      });
      if (resp.error) {
        console.warn("setMemberRole failed:", resp.error.message);
        return;
      }
      await fetchRoles();
    } finally {
      setBusy(null);
    }
  };

  //const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // const ModeratorOptionsPopup = ({ id, user, length }: { id: number; user: User, length: number }) => {
  //   return (
  //     <OptionsWrapper>
  //       <OptionsButton
  //         handleClick={() => {
  //           setOptionsOpen(id);
  //           setSelectedUser(user);
  //         }}
  //       />
  //       {optionsOpen === id && (
  //         <TopOverlay bottomPadding={length - 3 <= id}>
  //           <OptionsWindow>
  //             {selectedUser && selectedUser.id !== channelOwner && (
  //               <Option
  //                 onClick={() =>
  //                   promoteModerator(selectedUser.id, !selectedUser.moderator)
  //                 }
  //               >{`${
  //                 selectedUser.moderator ? "Remove moderator" : "Make moderator"
  //               }`}</Option>
  //             )}
  //             {selectedUser && (
  //               <Option onClick={() => removeUserFromChannel(selectedUser.id)}>
  //                 Remove from channel
  //               </Option>
  //             )}
  //           </OptionsWindow>
  //         </TopOverlay>
  //       )}
  //     </OptionsWrapper>
  //   );
  // };

  return (
    <>
      {optionsOpen !== -1 && <OverLay onClick={() => setOptionsOpen(-1)} />}
      {props.isOwner && (
        <AddUserDialog
          addMember={props.addMember}
          channelName={props.channelName}
          nonChannelMembers={props.nonChannelMembers}
        />
      )}
      <UserList>
        {userList.size > 0 &&
          Array.from(userList.entries()).map(([identity, username], id) => {
            const targetRole = roleOf(identity);
            const isSelf = identity === props.myContextIdentity;
            const isOwnerRow = identity === props.channelOwner;

            // Promote/demote: Admin only.
            const promoteTo = promoteTarget(targetRole);
            const demoteTo = demoteTarget(targetRole);
            const showPromote =
              myRole === "Admin" && !isSelf && !isOwnerRow && !!promoteTo;
            const showDemote =
              myRole === "Admin" && !isSelf && !isOwnerRow && !!demoteTo;
            // Ban/unban: Admin can act on anyone (except self/owner).
            // Mod can only flip Users (i.e. not other Mods/Admins).
            const canBanThis =
              !isSelf && !isOwnerRow &&
              (myRole === "Admin" ||
                (myRole === "Mod" && (targetRole === "User" || targetRole === "Banned")));
            const showBan = canBanThis && targetRole !== "Banned";
            const showUnban = canBanThis && targetRole === "Banned";

            return (
              <HoverRow key={identity}>
                <UserInfo>
                  <Avatar size="xs" name={username ?? ""} />
                  <Text $isSelected={optionsOpen === id}>
                    {username}
                  </Text>
                </UserInfo>

                {/* Badge sits outside RowActions so it's always visible
                    (RowActions is opacity:0 until row hover; that gate
                    applies only to the action buttons below). */}
                <RoleBadge $role={targetRole}>{targetRole}</RoleBadge>

                <RowActions>
                  {canModerate && showPromote && (
                    <ActionBtn
                      title={`Promote to ${promoteTo}`}
                      disabled={busy === identity}
                      onClick={() => void applyRole(identity, promoteTo!)}
                    >
                      ↑ {promoteTo}
                    </ActionBtn>
                  )}
                  {canModerate && showDemote && (
                    <ActionBtn
                      title={`Demote to ${demoteTo}`}
                      disabled={busy === identity}
                      onClick={() => void applyRole(identity, demoteTo!)}
                    >
                      ↓ {demoteTo}
                    </ActionBtn>
                  )}
                  {canModerate && showBan && (
                    <ActionBtn
                      $variant="danger"
                      title="Ban from this channel (app-level)"
                      disabled={busy === identity}
                      onClick={() => void applyRole(identity, "Banned")}
                    >
                      Ban
                    </ActionBtn>
                  )}
                  {canModerate && showUnban && (
                    <ActionBtn
                      title="Unban (restore as User)"
                      disabled={busy === identity}
                      onClick={() => void applyRole(identity, "User")}
                    >
                      Unban
                    </ActionBtn>
                  )}

                  {props.isOwner && identity !== props.channelOwner && (
                    <RemoveButton
                      title="Remove from channel"
                      aria-label="Remove from channel"
                      onClick={() => void props.removeUserFromChannel(identity)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </RemoveButton>
                  )}
                </RowActions>
              </HoverRow>
            );
          })}
      </UserList>
    </>
  );
};

export default MemberDetails;
