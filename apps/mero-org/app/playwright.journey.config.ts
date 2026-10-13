import path from "node:path";
import { fileURLToPath } from "node:url";
import { journeyConfig } from "@calimero-apps/e2e-node/config";

// Three nodes: the founder's, and two members whose nodes follow an app namespace.
process.env["JOURNEY_NODES"] ??= "3";

export default journeyConfig({
  appDir: path.dirname(fileURLToPath(import.meta.url)),
  packageId: "com.calimero.mero-org",
});
