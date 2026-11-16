import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { APP_PACKAGE } from "../../config";
import { useSessionApi } from "../../sessionContext";
import { suggestedName } from "../../utils/boardName";

const LABELS = {
  title: "New team",
  subtitle: "Name your team. Its boards sync between its members.",
  nameLabel: "Team name",
  namePlaceholder: "e.g. Studio",
  selfLabel: "Your name in this team",
  selfPlaceholder: "e.g. Alice",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (created: { orgId: string; name: string; selfName: string }) => void;
}

/** The shared create dialog, with this app's wording and the release a board is made from. */
export default function NewTeamDialog({ open, onClose, onCreated }: Props) {
  const { binding } = useSessionApi();
  const { source, pending } = useResolvedSource(binding?.client ?? null, binding?.accountId ?? null, binding?.source ?? { package: APP_PACKAGE });
  if (!binding) return null;
  return (
    <CreateWorkspaceDialog
      client={binding.client}
      passkey={binding.passkey()}
      release={pending ? null : (reviewRelease(source) ?? { package: APP_PACKAGE })}
      defaultSelfName={lastUsedName() || suggestedName(binding.accountId)}
      open={open}
      onClose={onClose}
      onCreated={onCreated}
      labels={LABELS}
    />
  );
}
