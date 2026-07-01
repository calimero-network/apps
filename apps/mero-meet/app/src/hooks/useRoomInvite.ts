import { useCallback, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { useMeroMeet } from "./useMeroMeet";
import { encodeInvitationObject } from "../lib/invitation";

/**
 * The room-invite flow, shared by the lobby and the in-call invite button.
 *
 * An invite = a namespace invitation for this room (same mechanism as the other
 * mero apps): resolve the room's namespace, mint a signed invitation, ship it as
 * a url-safe token the invitee pastes into "Join" on the Rooms screen.
 */
export function useRoomInvite(roomName?: string) {
  const { mero } = useMero();
  const meet = useMeroMeet();
  const [code, setCode] = useState("");
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    if (!mero || !meet.contextId || inviting) return;
    setInviting(true);
    try {
      const namespaceId = await mero.admin.getContextGroup(meet.contextId);
      if (!namespaceId) throw new Error("no namespace for this room");
      const inv = await mero.admin.createNamespaceInvitation(namespaceId);
      const token = encodeInvitationObject({
        ...(inv as unknown as Record<string, unknown>),
        __roomName: roomName ?? "",
      });
      setCode(token);
      setCopied(false);
      try {
        await navigator.clipboard.writeText(token);
        setCopied(true);
      } catch {
        /* clipboard blocked — user can still copy from the box */
      }
    } catch {
      setCode("");
    } finally {
      setInviting(false);
    }
  }, [mero, meet.contextId, inviting, roomName]);

  const copy = useCallback(() => {
    if (!code) return;
    void navigator.clipboard.writeText(code);
    setCopied(true);
  }, [code]);

  const reset = useCallback(() => {
    setCode("");
    setCopied(false);
  }, []);

  return { code, inviting, copied, generate, copy, reset };
}
