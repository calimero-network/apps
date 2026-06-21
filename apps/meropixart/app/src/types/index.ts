// ── Domain types — mirror the WASM contract's serde (camelCase) shapes ─────────

export type LayerKind = "raster" | "group" | "text" | "adjustment" | "fill";

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
  hue: number;        // -180..180
  exposure: number;   // -100..100
  blur: number;       // 0..100 px
  invert: boolean;
  curves?: string;    // JSON-encoded spline control points
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  exposure: 0,
  blur: 0,
  invert: false,
  curves: "",
};

export interface TextProps {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align?: string;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  parentId?: string | null;
  layerIndex: number;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  blendMode: BlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number; // percent, 100 = 1:1
  scaleY: number;
  blobId?: string;
  maskBlobId?: string | null;
  fill?: string;
  adjustments: Adjustments;
  text?: TextProps | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentInfo {
  name: string;
  description: string;
  width: number;
  height: number;
  background: string;
  layerCount: number;
  memberCount: number;
  owner?: string | null;
}

export interface Member {
  id: string;
  username: string;
  avatar: string | null;
  joinedAt: number;
}

export type Role = "admin" | "editor" | "viewer";

export interface MemberRole {
  member: string;
  role: Role;
}

export interface CursorState {
  identity: string;
  x: number;
  y: number;
  updatedAt: number;
}

// ── Workspace structure ─────────────────────────────────────────────────────

export interface Team {
  groupId: string; // namespace id
  name: string;
}

export interface Project {
  contextId: string;
  groupId: string; // subgroup id (used for role/member management)
  name: string;
  description: string;
  thumbnailBlobId?: string;
}

// ── Editor tools ────────────────────────────────────────────────────────────

export type Tool =
  | "move"
  | "marquee"
  | "lasso"
  | "crop"
  | "brush"
  | "eraser"
  | "bucket"
  | "eyedropper"
  | "text"
  | "shape"
  | "gradient"
  | "transform"
  | "clone"
  | "hand"
  | "zoom";
