// Builds the launcher panorama's world off the main thread (see panorama.ts).

import { buildPanoramaScene, sceneTransferables } from "./panoramaScene";

// The app's tsconfig has no WebWorker lib; this is the slice of the worker
// global used here.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ seed: number }>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const scene = buildPanoramaScene(e.data.seed);
  scope.postMessage(scene, sceneTransferables(scene));
};
