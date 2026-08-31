import { v4 as uuid } from "uuid";
import { rpcCall, adminUploadBlob } from "../api/rpc";
import type { Element } from "../types";
import { toDataUrl } from "./image";
import { boundsOf, elementsToSvg, svgToPngDataUrl } from "./svgExport";
import { saveDataUrl, saveText } from "./saveFile";
import type { LabelPatch } from "./groups";

/**
 * The side-effecting half of grouping: pushing label changes to the contract,
 * exporting a group, and flattening one into a single element.
 *
 * Kept out of the panel component so it can be tested without a DOM, and out of
 * `groups.ts` so that stays a pure model.
 */

export interface OpDeps {
  contextId: string;
  /** Optimistic local update; the RPCs follow. */
  applyLabels: (patch: LabelPatch) => void;
  onError: (method: string, error: unknown) => void;
}

/**
 * Persists a label patch. Every element is written with `update_element_label`,
 * the contract method the board already has — which is the whole reason groups
 * are paths in the label rather than a new field that would need new WASM.
 *
 * Local state is updated first: regrouping 40 layers should not look frozen
 * while 40 round-trips land.
 */
export async function applyLabelPatch(patch: LabelPatch, deps: OpDeps): Promise<void> {
  const ids = Object.keys(patch);
  if (ids.length === 0) return;
  deps.applyLabels(patch);
  const updatedAt = Date.now();
  for (const id of ids) {
    await rpcCall(deps.contextId, "update_element_label", {
      id,
      label: patch[id],
      updated_at: updatedAt,
    }).catch((e) => deps.onError("update_element_label", e));
  }
}

/** id → data: URL for every image/svg element that has cached bytes. */
export async function imageDataFor(
  elements: Element[],
  imageCache: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    elements
      .filter((el) => (el.data.kind === "image" || el.data.kind === "svg") && imageCache[el.id])
      .map(async (el) => {
        try {
          out[el.id] = await toDataUrl(imageCache[el.id]);
        } catch {
          // Skipped, so the export shows a placeholder box instead of failing.
        }
      }),
  );
  return out;
}

export interface ExportOptions {
  filename: string;
  background?: string;
  imageCache?: Record<string, string>;
  padding?: number;
}

/** Writes these elements out as one SVG file. */
export async function exportElementsAsSvg(elements: Element[], options: ExportOptions): Promise<boolean> {
  if (elements.length === 0) return false;
  const imageData = await imageDataFor(elements, options.imageCache ?? {});
  const svg = elementsToSvg(elements, {
    imageData,
    background: options.background,
    padding: options.padding,
  });
  return saveText(svg, options.filename, "image/svg+xml");
}

/** Writes these elements out as one PNG, rasterised at 2×. */
export async function exportElementsAsPng(elements: Element[], options: ExportOptions): Promise<boolean> {
  if (elements.length === 0) return false;
  const imageData = await imageDataFor(elements, options.imageCache ?? {});
  const box = boundsOf(elements, options.padding ?? 0);
  const svg = elementsToSvg(elements, {
    imageData,
    background: options.background,
    padding: options.padding,
  });
  const png = await svgToPngDataUrl(svg, box.width, box.height, 2);
  return saveDataUrl(png, options.filename);
}

export interface FlattenDeps extends OpDeps {
  imageCache: Record<string, string>;
  background?: string;
  /** Local mirror of the contract write, so the canvas updates immediately. */
  onFlattened: (created: Element, removedIds: string[]) => void;
  cacheImage: (elementId: string, url: string) => void;
}

/**
 * Merges elements into a single `svg` element — Figma's "flatten".
 *
 * The markup is uploaded as a blob (so it reaches every peer the way an imported
 * image does) and one element replaces the originals. This is what takes a
 * 40-layer button down to one layer; the starter board is 470 elements and most
 * of them never need to be individually editable again.
 *
 * Destructive and not undoable through the contract, so callers confirm first.
 * The originals are deleted only after the replacement is committed — if the
 * upload or the add fails, nothing is lost.
 */
export async function flattenElements(
  elements: Element[],
  name: string,
  deps: FlattenDeps,
): Promise<Element> {
  if (elements.length === 0) throw new Error("Nothing to flatten");
  const imageData = await imageDataFor(elements, deps.imageCache);
  const svg = elementsToSvg(elements, { imageData });
  const box = boundsOf(elements);

  const bytes = new TextEncoder().encode(svg);
  const { blobId } = await adminUploadBlob(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    deps.contextId,
  );
  if (!blobId) throw new Error("The node did not return a blob id for the flattened image");

  const created: Element = {
    id: uuid(),
    data: { kind: "svg", naturalWidth: box.width, naturalHeight: box.height, blobId },
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 100,
    // Sits where the front-most member sat, so flattening does not reorder the board.
    layerIndex: Math.max(...elements.map((e) => e.layerIndex)),
    createdBy: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    label: name,
  };

  await rpcCall(deps.contextId, "add_element", { element: created });

  const removedIds = elements.map((e) => e.id);
  // Show it before the deletes land, and without waiting for the blob to come
  // back down from the node.
  deps.cacheImage(created.id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  deps.onFlattened(created, removedIds);

  for (const id of removedIds) {
    await rpcCall(deps.contextId, "delete_element", { id }).catch((e) => deps.onError("delete_element", e));
  }
  return created;
}
