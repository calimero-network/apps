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
  /** "x1,y1 x2,y2" in element-local space — line/arrow endpoints, and path data. */
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
  /**
   * The contract's `label` field (`update_element_label`). The layers panel keeps
   * its own local label store, so nothing in the UI reads this yet — but
   * `add_element` sends the whole element, so it round-trips, and the bundled
   * starter project uses it to name its parts.
   */
  label?: string | null;
  /** Corner radius in px; clamped to min(width, height) / 2 when applied. */
  cornerRadius?: number | null;
  shadowColor?: string | null;
  shadowOffsetX?: number | null;
  shadowOffsetY?: number | null;
  shadowBlur?: number | null;

  // ── Client-side extras ────────────────────────────────────────────────
  // None of these exist in the contract. They travel inside `label`, after a
  // separator, and `api/rpc.ts` packs/unpacks them at the wire so nothing above
  // the RPC layer ever sees the packed form — see `utils/elementMeta.ts` for
  // why they are not contract fields.

  /** Dash pattern of the outline. Absent = solid. */
  strokeStyle?: StrokeStyle;
  /**
   * A `text` element painted as a container: `fill` is the box, `stroke` its
   * border, and the words sit inside it aligned by `text_align` /
   * `vertical_align`. "sticky" is the same box with sticky-note styling.
   */
  box?: BoxKind;
  /** Text colour inside a box or sticky. Absent = picked for contrast with `fill`. */
  textColor?: string;
  /** For a `path` drawn by a shape tool: which outline to regenerate at any size. */
  shape?: ShapeKind;
  /** A line/arrow docked to a shape: "<element id>:<top|right|bottom|left>" (utils/connectors). */
  startBinding?: string;
  endBinding?: string;
}

export type StrokeStyle = "solid" | "dashed" | "dotted" | "dashdot" | "dotted3" | "long";
export type BoxKind = "box" | "sticky";
export type ShapeKind = "triangle" | "diamond" | "star" | "cloud";

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
  // The subgroup's group id (hex 32 bytes). Distinct from contextId — a
  // DIFFERENT id, though core 0.11.0-rc.27 made both 64 hex so they no longer
  // look different (core#3691):
  // member/role admin-API endpoints key off the group id, not the context id.
  groupId: string;
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
