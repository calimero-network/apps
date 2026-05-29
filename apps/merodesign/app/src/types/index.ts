export type ElementKind =
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "path"
  | "text"
  | "image"
  | "svg";

export interface ElementData {
  kind: ElementKind;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  // text_align and vertical_align: WASM emits snake_case (no rename on these fields)
  // eslint-disable-next-line camelcase
  text_align?: "left" | "center" | "right";
  // eslint-disable-next-line camelcase
  vertical_align?: "top" | "middle" | "bottom";
  // fontSize/fontFamily/naturalWidth/naturalHeight: WASM renames to camelCase via #[serde(rename)]
  points?: string;
  blobId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface Element {
  id: string;
  data: ElementData;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  layerIndex: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  shadowColor?: string | null;
  shadowOffsetX?: number | null;
  shadowOffsetY?: number | null;
  shadowBlur?: number | null;
}

export interface Member {
  id: string;
  username: string;
  avatar: string | null;
  joinedAt: number;
}

export interface Board {
  name: string;
  description: string;
  elementCount: number;
  memberCount: number;
}

export interface Project {
  contextId: string;
  name: string;
  description: string;
  isPublic: boolean;
}

export interface Team {
  groupId: string;
  name: string;
}

export interface CommentReply {
  id: string;
  content: string;
  author: string;
  createdAt: number;
}

export interface CanvasComment {
  id: string;
  x: number;
  y: number;
  content: string;
  author: string;
  createdAt: number;
  replies: CommentReply[];
}

export interface CursorState {
  identity: string;
  x: number;
  y: number;
  updatedAt: number;
  // eslint-disable-next-line camelcase
  updated_at?: number;
}
