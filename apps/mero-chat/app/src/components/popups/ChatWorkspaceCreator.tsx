import { useCallback, useRef } from "react";
import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";

import { APP_PACKAGE, chatSource, passkey, useCalimero } from "../../api/calimero";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { useToast } from "../../contexts/ToastContext";
import { closeCreateWorkspace, useCreateWorkspaceOpen } from "../../utils/createWorkspaceStore";
import { finishWorkspace } from "../../utils/finishWorkspace";

const LABELS = {
  title: "Create workspace",
  subtitle: "Name your server, and choose how others in it will see you.",
  nameLabel: "Server name",
  namePlaceholder: "e.g. My Team",
  selfLabel: "Your name",
  selfPlaceholder: "e.g. Alice",
};

/**
 * The shared create-workspace dialog on Chat's session. It also finishes a
 * workspace approved on a full-page trip to the node, so it is mounted once,
 * above the routes, while signed in.
 */
export default function ChatWorkspaceCreator() {
  const { session: current } = useCalimero();
  const session = current?.status === "signed-in" ? current : null;
  const { addToast } = useToast();
  const open = useCreateWorkspaceOpen();
  const api = useRef(new GroupApiDataSource());
  const { source, pending } = useResolvedSource(session?.client ?? null, session?.accountId ?? null, chatSource());

  const onCreated = useCallback(
    async ({ orgId, name, selfName }: { orgId: string; name: string; selfName: string }) => {
      closeCreateWorkspace();
      await finishWorkspace(api.current, orgId, name, selfName, addToast);
    },
    [addToast],
  );

  if (!session) return null;
  return (
    <CreateWorkspaceDialog
      client={session.client}
      passkey={passkey()}
      release={pending ? null : (reviewRelease(source) ?? { package: APP_PACKAGE })}
      defaultSelfName={lastUsedName()}
      open={open}
      onClose={closeCreateWorkspace}
      onCreated={onCreated}
      labels={LABELS}
    />
  );
}
