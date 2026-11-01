import type { ConnectEnv } from "@calimero-apps/connect";

import { runMatrix, type MatrixEnv } from "./conformance/matrix";
import type { Row } from "./conformance/types";

/** What the page is built from: the real ones in the app, fakes in tests. */
export interface AppDeps {
  env: ConnectEnv;
  /** The origin the software passkeys answer for: the page's own. */
  origin: string;
  run: (env: MatrixEnv) => Promise<Row[]>;
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: AppDeps = {
  env: import.meta.env,
  origin: globalThis.location?.origin ?? "http://localhost:5173",
  run: runMatrix,
};
