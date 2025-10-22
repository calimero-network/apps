import { Message, Title, Wrapper } from "./HandleDMSetup";
import type { ActiveChat } from "../types/Common";
import { getDMSetupState } from "../utils/dmSetupState";
import { DMSetupState } from "../types/Common";

interface InvitationPendingProps {
  activeChat: ActiveChat;
}

export default function InvitationPending({
  activeChat,
}: InvitationPendingProps) {
  const dmSetupState = getDMSetupState(activeChat);

  // Only show this component when we're actually waiting for invitation
  if (dmSetupState !== DMSetupState.INVITEE_WAITING_INVITATION) {
    return null;
  }

  return (
    <Wrapper>
      <Title>Setup</Title>
      <Message>Waiting for other user to invite you to the private DM.</Message>
      <Message className="padding">
        Once user has invited you, you will be able to join the private DM.
      </Message>
    </Wrapper>
  );
}
