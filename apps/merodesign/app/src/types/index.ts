export type ElementKind =
  | "Rect"
  | "Circle"
  | "Line"
  | "Arrow"
  | "Path"
  | "Text"
  | "Image"
  | "Svg";

export interface ElementData {
  kind: ElementKind;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
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
