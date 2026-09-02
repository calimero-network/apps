// Shared fixtures for the unit suite.
//
// `Layer` has grown to ~25 fields, most of which any given test does not care
// about. One factory keeps the tests about the thing they are testing, and means
// a new contract field breaks one file instead of twelve.

import { NEUTRAL_ADJUSTMENTS, type Layer, type LayerKind } from "../types";

let seq = 0;

/** A neutral raster layer. Override anything that matters to the test. */
export function makeLayer(patch: Partial<Layer> = {}): Layer {
  seq += 1;
  const id = patch.id ?? `layer-${seq}`;
  return {
    id,
    name: patch.name ?? id,
    kind: "raster",
    parentId: null,
    layerIndex: 0,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: "normal",
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, scaleX: 100, scaleY: 100,
    skewX: 0, skewY: 0, flipH: false, flipV: false, warp: "",
    blobId: "",
    maskBlobId: null,
    fill: "",
    adjustments: { ...NEUTRAL_ADJUSTMENTS },
    text: null,
    createdBy: "tester",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

/** A folder layer. */
export function makeGroup(patch: Partial<Layer> = {}): Layer {
  return makeLayer({ kind: "group", name: patch.name ?? "Group", ...patch });
}

/** A layer of a given kind, for table-driven tests. */
export function makeKind(kind: LayerKind, patch: Partial<Layer> = {}): Layer {
  return makeLayer({ kind, ...patch });
}

/** Reset the id counter so ids are stable inside a single test file run. */
export function resetLayerIds(): void {
  seq = 0;
}
