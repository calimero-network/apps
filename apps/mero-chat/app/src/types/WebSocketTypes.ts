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
  | "ChannelInvited"
  | "ChannelLeft"
  | "MessageSent"
  | "MessageSentThread"
  | "MessageReceived"
  | "ChannelJoined"
  | "DMCreated"
  | "ReactionUpdated"
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

export interface WebSocketEvent {
  contextId: string;
  type: "StateMutation" | string;
  data?: StateMutationData;
  timestamp?: number;
}

export type WebSocketEventCallback = (event: WebSocketEvent) => Promise<void>;
