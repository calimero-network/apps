import { useEffect, useRef, useState } from "react";
import { consentReturn } from "@calimero-network/mero-js";

import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { returnFromConsent, type ConsentReturned } from "../../api/consent";
import { invalidate } from "../../api/platform";
import { getAccountId } from "../../api/calimero";
import { clearWorkspaceSelection, getGroupId, setStoredGroupAlias } from "../../constants/config";
import { useToast } from "../../contexts/ToastContext";
import { enterJoinedWorkspaceForName, enterWorkspace } from "../../utils/enterWorkspace";
import { finishWorkspace } from "../../utils/finishWorkspace";
import { dropInvite } from "../../utils/invitation";
import { log } from "../../utils/logger";
import { getMessengerDisplayName } from "../../utils/messengerName";
import { nodeBasename } from "../../utils/servedByNode";
import { clearNamespaceReady } from "../../utils/session";
import GroupInviteModal from "./GroupInviteModal";

/**
 * Finishes what Chat sent the person to the node's consent page for, when the
 * page sends them back (`?request_id=…&result=…`, see `api/consent.ts`): the
 * new workspace is named, given #general and entered; the minted invite's link
 * is shown; the joined workspace is entered; an organization role, a removal
 * or a new name is said; a workspace left or deleted is closed, back to the
 * picker. What the approval made is read
 * from the node's sealed result, never from the return URL, and a return that
 * does not match the request this tab started is refused by `resumeConsent`.
 */
export default function ConsentReturn({ enabled }: { enabled: boolean }) {
  const api = useRef(new GroupApiDataSource());
  const { addToast } = useToast();
  const started = useRef(false);
  const [invite, setInvite] = useState<{ org: string; token: string } | null>(null);

  useEffect(() => {
    if (!enabled || started.current || !consentReturn(window.location.href)) return;
    started.current = true;
    void (async () => {
      let returned: ConsentReturned | null;
      try {
        returned = await returnFromConsent();
      } catch (e) {
        log.warn("ConsentReturn", "the consent page's return was refused", e);
        addToast({
          title: "Nothing was changed",
          message: "This approval did not come from the request Chat made. Try again from Chat.",
          type: "channel",
          duration: 10000,
        });
        return;
      }
      if (!returned) return;
      const { intent, result } = returned;
      if (result.status !== "approved") {
        addToast({ title: "Not approved", message: "Nothing was changed.", type: "channel", duration: 6000 });
        return;
      }
      invalidate();
      switch (result.kind) {
        case "createOrg": {
          const orgId = result.outcome?.orgId;
          if (!orgId || intent?.kind !== "createOrg") return;
          await finishWorkspace(api.current, orgId, intent.name, intent.selfName, addToast);
          return;
        }
        case "createInvite": {
          const token = result.outcome?.token;
          if (token && intent?.kind === "createInvite") setInvite({ org: intent.org, token });
          return;
        }
        case "acceptInvite": {
          const org = result.outcome?.org;
          dropInvite();
          if (!org) return;
          const meta = await api.current.getGroupMetadata(org).catch(() => null);
          const alias = meta?.data?.name?.trim();
          if (alias) setStoredGroupAlias(org, alias);
          log.info("ConsentReturn", `joined workspace ${org}`);
          const name = getMessengerDisplayName(org);
          if (name) enterWorkspace(api.current, org, name, getAccountId());
          else enterJoinedWorkspaceForName(org);
          return;
        }
        case "setMemberRole": {
          if (intent?.kind !== "setMemberRole") return;
          invalidate(intent.org);
          addToast({
            title: intent.role === "admin" ? "Organization admin" : "Organization role changed",
            message:
              intent.role === "admin"
                ? "They are now an admin of this organization."
                : "They are no longer an admin of this organization.",
            type: "channel",
            duration: 5000,
          });
          return;
        }
        case "removeMember": {
          if (intent?.kind === "removeMember") invalidate(intent.org);
          addToast({
            title: "Member removed",
            message: "They have been removed from the workspace.",
            type: "channel",
            duration: 5000,
          });
          return;
        }
        case "renameOrg": {
          const org = result.outcome?.orgId ?? (intent?.kind === "renameOrg" ? intent.org : null);
          const name = result.outcome?.name ?? (intent?.kind === "renameOrg" ? intent.name : "");
          if (org && name) setStoredGroupAlias(org, name);
          addToast({
            title: "Workspace renamed",
            message: name ? `The workspace is now called ${name}.` : "The workspace has a new name.",
            type: "channel",
            duration: 5000,
          });
          return;
        }
        case "leaveOrg":
        case "deleteOrg": {
          const org = intent?.kind === result.kind ? intent.org : null;
          addToast({
            title: result.kind === "leaveOrg" ? "Left workspace" : "Workspace deleted",
            message: result.kind === "leaveOrg" ? "You have left the workspace." : "The workspace has been deleted.",
            type: "channel",
            duration: 5000,
          });
          // Out of the workspace this tab was in: back to the picker.
          if (org && getGroupId() === org) {
            clearWorkspaceSelection();
            clearNamespaceReady();
            window.location.href = nodeBasename() + "login";
          }
          return;
        }
        default:
          return;
      }
    })();
  }, [enabled, addToast]);

  if (!invite) return null;
  return (
    <GroupInviteModal
      groupId={invite.org}
      isOpen
      onClose={() => setInvite(null)}
      initialInvitationPayload={invite.token}
    />
  );
}
