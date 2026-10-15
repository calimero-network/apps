import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_CX, WORLD_CY, WORLD_CZ } from "../src/engine/world";
import { spawnPoint } from "../src/engine/terrain";
import { buildPanoramaScene, sceneTransferables } from "../src/ui/panoramaScene";

const terrain = vi.hoisted(() => ({ generated: 0 }));
vi.mock("../src/engine/terrain", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/engine/terrain")>();
  return {
    ...real,
    generateWorld: (...args: Parameters<typeof real.generateWorld>) => {
      terrain.generated++;
      return real.generateWorld(...args);
    },
  };
});

class FakeWorker {
  static made: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.made = [];
});

describe("launcher panorama", () => {
  // The world used to be generated in a rAF callback on the main thread right
  // as the launcher's "Connect a node" button appeared, freezing the page for
  // seconds (CI: the journey's click on that button timed out).
  it("never generates its world on the main thread", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const { Panorama } = await import("../src/ui/panorama");
    terrain.generated = 0;

    const p = new Panorama(document.body);

    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.posted).toEqual([{ seed: 1337 }]);
    for (const cb of raf.mock.calls) cb[0](0);
    expect(terrain.generated).toBe(0);

    p.destroy();
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    expect(document.querySelector("[data-testid=panorama]")).toBeNull();
  });

  it("builds the whole world as transferable meshes", () => {
    const scene = buildPanoramaScene(1337);
    expect(scene.eye).toEqual(spawnPoint(1337));
    expect(scene.chunks).toHaveLength(WORLD_CX * WORLD_CY * WORLD_CZ);
    expect(scene.chunks.some((c) => c.opaque.faceCount > 0)).toBe(true);
    const buffers = sceneTransferables(scene);
    expect(buffers).toHaveLength(scene.chunks.length * 8);
    expect(new Set(buffers).size).toBe(buffers.length); // a buffer listed twice fails postMessage
  });
});
