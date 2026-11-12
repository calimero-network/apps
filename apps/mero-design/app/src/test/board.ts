import { vi } from "vitest";

import { MeroDesignClient } from "../generated/client";

/**
 * `design` for a test: the real `MeroDesignClient` over a fake transport whose
 * every call and view answers `result`. The calls land in the returned
 * `call` / `view` mocks with the ABI's method and argument names.
 */
export function boardAnswering(result: unknown) {
  const call = vi.fn(async () => ({ result, index: 1, events: [] }));
  const view = vi.fn(async () => ({ result, index: 1 }));
  const design = (app: string) => new MeroDesignClient({ apps: { call, view } }, app);
  return Object.assign(design, { call, view });
}
