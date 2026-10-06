// Aliased over ../../src/lib/inviteCodec. Decoding a real signed invitation is
// not what the prompt screenshot is about, so any token decodes to a fixture.
export type {
  ForumInvitePayload,
  SignedInvitation,
  InviteKind,
} from "../../src/lib/inviteCodec.ts";
import type { ForumInvitePayload } from "../../src/lib/inviteCodec.ts";

export function decodeInvite(): ForumInvitePayload | null {
  return {
    invitation: {} as ForumInvitePayload["invitation"],
    groupAlias: "Design review",
  };
}
