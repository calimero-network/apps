// Mirrors the WASM contract's serde output (camelCase). Keep in sync with
// logic/src/lib.rs.

export interface Presence {
  memberId: string;
  username: string;
  status: "available" | "in_call" | "away" | string;
  muted: boolean;
  videoOn: boolean;
  callId: string | null;
  joinedAt: number;
  updatedAt: number;
}

export interface Signal {
  id: string;
  seq: number;
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice" | "bye" | string;
  payload: string;
  callId: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  seq: number;
  from: string;
  username: string;
  text: string;
  createdAt: number;
}

export interface RoomInfo {
  name: string;
  owner: string | null;
  memberCount: number;
  onlineCount: number;
  activeCall: string;
}

export interface LobbyView {
  room: RoomInfo;
  members: Presence[];
  online: string[];
}
