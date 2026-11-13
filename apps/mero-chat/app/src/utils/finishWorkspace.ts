/**
 * What "Create workspace" does once its organization exists: name it, give
 * its members Chat's default capabilities, make #general, and enter it.
 *
 * Shared by the picker's own create (`NamespaceEntryPopup`) and by the return
 * from the node's consent page (`ConsentReturn`), where the organization was
 * created on the page for a session opened on Chat's frontend.
 */
import type { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import type { ToastNotification } from "../components/common/ToastManager";
import { setStoredGroupAlias, setGroupMemberIdentity } from "../constants/config";
import { createChannel, GENERAL_CHANNEL } from "./createChannel";
import { enterWorkspace } from "./enterWorkspace";
import { DEFAULT_MEMBER_CAPABILITIES } from "./groupCapabilities";
import { setMessengerDisplayName } from "./messengerName";

type Toast = (toast: Omit<ToastNotification, "id">) => string;

export async function finishWorkspace(
  api: Pick<
    GroupApiDataSource,
    "setGroupMetadata" | "setDefaultCapabilities" | "resolveCurrentMemberIdentity" | "setMemberMetadata"
  >,
  groupId: string,
  name: string,
  selfName: string,
  addToast: Toast,
): Promise<void> {
  setStoredGroupAlias(groupId, name);
  // Before #general, so the channel is made under your name in it.
  setMessengerDisplayName(selfName, groupId);
  // The `name` the org was created with does not reach the group's metadata
  // record — a freshly created namespace reads back `metadata: null` — so
  // write it explicitly. The creator is the owner, so this succeeds and gives
  // the workspace a name everyone can see.
  await api.setGroupMetadata(groupId, name).catch(() => {});

  // A session opened on Chat's frontend is refused this (core#4934): the
  // workspace then keeps the org's defaults until an admin changes them.
  await api.setDefaultCapabilities(groupId, { defaultCapabilities: DEFAULT_MEMBER_CAPABILITIES }).catch(() => {});

  // Every workspace starts with #general: someone who joins from an
  // invitation lands in a channel rather than an empty workspace, and the
  // join can wait for a channel to arrive instead of taking an empty list
  // (not synced yet) for an empty workspace. The workspace stands without
  // it, so a failure here is said, not fatal.
  const general = await createChannel(groupId, GENERAL_CHANNEL, true).catch((err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  if ("error" in general) {
    addToast({
      title: "Workspace created without #general",
      message: `Create a channel before inviting anyone: ${general.error}`,
      type: "channel",
      duration: 12000,
    });
  }

  const idRes = await api.resolveCurrentMemberIdentity(groupId);
  const memberIdentity = idRes.data?.memberIdentity ?? "";
  if (memberIdentity) setGroupMemberIdentity(groupId, memberIdentity);

  // Named in the same step: straight in. `enterWorkspace` publishes the name
  // to the org's member record, and loads the app on this workspace.
  enterWorkspace(api, groupId, selfName, memberIdentity);
}
