import { useEffect, useRef, useState } from "react";
import { consentReturn } from "@calimero-network/mero-js";

import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { returnFromConsent, type ConsentReturned } from "../../api/consent";
import { invalidate } from "../../api/platform";
import { getAccountId } from "../../api/calimero";
import { setStoredGroupAlias } from "../../constants/config";
import { useToast } from "../../contexts/ToastContext";
import { enterJoinedWorkspaceForName, enterWorkspace } from "../../utils/enterWorkspace";
import { finishWorkspace } from "../../utils/finishWorkspace";
import { dropInvite } from "../../utils/invitation";
import { log } from "../../utils/logger";
import { getMessengerDisplayName } from "../../utils/messengerName";
import GroupInviteModal from "./GroupInviteModal";

/**
 * Finishes what Chat sent the person to the node's consent page for, when the
 * page sends them back (`?request_id=…&result=…`, see `api/consent.ts`): the
 * new workspace is named, given #general and entered; the minted invite's link
 * is shown; the joined workspace is entered. What the approval made is read
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
