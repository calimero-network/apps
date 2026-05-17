import { styled } from "styled-components";
import StartDMPopup, { type CreateContextResult } from "../popups/StartDMPopup";
import { useCallback, memo } from "react";
import { getGroupId } from "../../constants/config";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import type { DMContextInfo } from "../../hooks/useDMs";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.25rem 0.75rem 0.25rem ${(props) => (props.$isCollapsed ? "0.75rem" : "1rem")};
  margin-bottom: 0.125rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const TextBold = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
`;

const PlusButton = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.25);
  transition: all 0.15s ease;

  &:hover {
    color: #a5ff11;
    background: rgba(165, 255, 17, 0.1);
  }

  svg {
    stroke: currentColor;
  }
`;

interface DMHeaderProps {
  createDM: (value: string) => Promise<CreateContextResult>;
  availableMembers: Map<string, string>;
  privateDMs: DMContextInfo[];
  isCollapsed?: boolean;
  onFetchMembers?: () => Promise<void>;
}

const DMHeader = memo(function DMHeader({
  createDM,
  availableMembers,
  privateDMs,
  isCollapsed,
  onFetchMembers,
}: DMHeaderProps) {
  const permissions = useCurrentGroupPermissions(getGroupId());
  // Show while loading / before identity resolves; once resolved, allow
  // admins or members holding CAN_CREATE_SUBGROUP. A DM is a restricted
  // root-level subgroup + context (see createDmContextInGroup), same
  // primitive as channel creation.
  const resolved = !permissions.loading && permissions.memberIdentity !== "";
  const canShowCreate =
    !resolved || permissions.isAdmin || permissions.canCreateSubgroup;

  const isValidIdentityId = useCallback(
    (value: string) => {
      const identity = value.trim();
      const isMember = availableMembers.has(identity);

      if (!isMember) {
        return {
          isValid: false,
          error: "Cannot create DM: the user is not in the workspace",
        };
      }
      // Block (and disable Next via StartDMPopup's disabled-on-invalid wiring)
      // when a DM with this identity already exists, instead of letting the
      // user submit and surface the same error post-hoc from createDM.
      if (privateDMs.some((dm) => dm.otherIdentity === identity)) {
        return {
          isValid: false,
          error: "A DM with this user already exists",
        };
      }
      return { isValid: true, error: "" };
    },
    [availableMembers, privateDMs],
  );

  return (
    <Container $isCollapsed={isCollapsed}>
      {!isCollapsed && <TextBold>{"Direct Messages"}</TextBold>}
      {canShowCreate && (
        <StartDMPopup
          title="Create a new private DM context"
          placeholder="Search by member identity"
          buttonText="Next"
          toggle={
            <PlusButton>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </PlusButton>
          }
          chatMembers={availableMembers}
          validator={isValidIdentityId}
          functionLoader={createDM}
          onOpen={onFetchMembers}
        />
      )}
    </Container>
  );
});

export default DMHeader;
