/**
 * WebSocket event types for Calimero
 *
 * Structure:
 * StateMutation event contains an array of specific events from the Rust backend
 */

export type ExecutionEventKind =
  | "ChatInitialized"
  | "ChatJoined"
  | "ChannelCreated"
  | "ChannelDeleted"
  | "ChannelInvited"
  | "ChannelLeft"
  | "ChannelJoined"
  | "MessageSent"
  | "MessageSentThread"
  | "MessageReceived"
  | "DMCreated"
  | "DMDeleted"
  | "ReactionUpdated"
  | "RoleUpdated"
  | "NewIdentityUpdated"
  | "InvitationPayloadUpdated"
  | "InvitationAccepted"
  | string;

export interface ExecutionEventData {
  kind: ExecutionEventKind;
  data?: unknown;
}

export interface StateMutationData {
  events?: ExecutionEventData[];
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Group-membership change, core's `NodeEvent::GroupMembership`. Routed by
 * `groupId` and disjoint from context events — it carries no `contextId` and
 * no `data.events`, which is why the StateMutation path drops it.
 */
export type MembershipChangeKind =
  | "MemberJoined"
  | "MemberAdded"
  | "MemberRemoved";

export interface GroupMembershipData {
  member: string;
  role?: string;
}

export interface WebSocketEvent {
  /** Empty for group-membership events, which are keyed by `groupId`. */
  contextId: string;
  type: "StateMutation" | "GroupMembership" | string;
  /** Set only on group-membership events. */
  groupId?: string;
  /** `MemberJoined` / `MemberAdded` / `MemberRemoved` on membership events. */
  membershipKind?: MembershipChangeKind;
  /**
   * State-mutation payload. Kept as-is rather than widened to a union with
   * the membership payload: every consumer reads `data.events`, and widening
   * would force a narrow at each of those call sites for no benefit. The
   * membership payload rides in `membership` instead.
   */
  data?: StateMutationData;
  /** Set only on group-membership events. */
  membership?: GroupMembershipData;
  timestamp?: number;
}

export type WebSocketEventCallback = (event: WebSocketEvent) => Promise<void>;
