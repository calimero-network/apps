import { useCallback, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { useMeroMeet } from "./useMeroMeet";
import { mintRoomInvite } from "../lib/groups";

/**
 * The room-invite flow, shared by the lobby and the in-call invite button.
 *
 * ── Why this now goes through lib/groups ─────────────────────────────────────
 *
 * It used to mint the invitation itself and encode it with lib/invitation's
 * codec. That still produced a working code, but a DIFFERENT one from the codes
 * the teams and rooms pages mint — same grant, two encodings — and only one of
 * them was understood by the join path those pages use. An invite minted in the
 * lobby and pasted into "Join" was the one combination nobody tried.
 *
 * One codec, one mint, one parser: `mintRoomInvite` is what the rooms page uses,
 * and what `redeemInvite` reads back. It also carries the room's context id, so
 * the invitee lands in THIS room rather than at the team's room list.
 *
 * The grant is a namespace invitation either way — room membership is inherited,
 * so a room-scoped invitation is not expressible while rooms must stay open for
 * invited members to enter them at all. `mintRoomInvite` documents that in full.
 */
export function useRoomInvite(roomName?: string) {
  const { mero } = useMero();
  const meet = useMeroMeet();
  const [code, setCode] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!mero || !meet.contextId || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const namespaceId = await mero.admin.getContextGroup(meet.contextId);
      if (!namespaceId) throw new Error("no namespace for this room");
      setCode(
        await mintRoomInvite(mero.admin, {
          namespaceId,
          roomId: namespaceId,
          roomName,
          contextId: meet.contextId,
        }),
      );
    } catch (e) {
      // Surfaced rather than swallowed: the old version set the code to "" on
      // failure, which is indistinguishable from "you have not clicked Invite
      // yet" — so a mint that failed looked like a button that did nothing.
      setError(
        e instanceof Error ? e.message : "Could not mint an invitation.",
      );
      setCode("");
    } finally {
      setInviting(false);
    }
  }, [mero, meet.contextId, inviting, roomName]);

  /** Close the dialog. Named `reset` for the callers that already used it. */
  const reset = useCallback(() => {
    setCode("");
    setError(null);
  }, []);

  return { code, inviting, error, generate, reset };
}
