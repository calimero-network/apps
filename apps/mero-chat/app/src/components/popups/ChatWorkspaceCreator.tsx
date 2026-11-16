import { useCallback, useRef } from "react";
import { useResolvedSource, WorkspaceCreator } from "@calimero-apps/passkey";

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
    async ({ orgId, selfName }: { orgId: string; selfName: string }) => {
      closeCreateWorkspace();
      const name = (await api.current.getGroup(orgId)).data?.alias?.trim() || "Workspace";
      await finishWorkspace(api.current, orgId, name, selfName, addToast);
    },
    [addToast],
  );

  if (!session) return null;
  return (
    <WorkspaceCreator
      client={session.client}
      target={session.target}
      passkey={passkey}
      source={source}
      pending={pending}
      appPackage={APP_PACKAGE}
      open={open}
      onClose={closeCreateWorkspace}
      onCreated={onCreated}
      labels={LABELS}
    />
  );
}
