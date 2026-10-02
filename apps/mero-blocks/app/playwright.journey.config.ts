import path from "node:path";
import { fileURLToPath } from "node:url";
import { journeyConfig } from "@calimero-apps/e2e-node/config";

export default journeyConfig({
  appDir: path.dirname(fileURLToPath(import.meta.url)),
  packageId: "com.calimero.mero-blocks",
  use: {
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
});
