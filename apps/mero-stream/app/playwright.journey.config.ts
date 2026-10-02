import path from "node:path";
import { fileURLToPath } from "node:url";
import { journeyConfig } from "@calimero-apps/e2e-node/config";

export default journeyConfig({
  appDir: path.dirname(fileURLToPath(import.meta.url)),
  packageId: "com.calimero.mero-stream",
  use: {
    channel: "chrome",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
