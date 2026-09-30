import { stopRig } from "./rig";

export default async function journeyGlobalTeardown(): Promise<void> {
  const dataDir = process.env["JOURNEY_DATA_DIR"];
  if (!dataDir) return;
  await stopRig(dataDir, process.env["JOURNEY_KEEP_NODES"] === "1");
}
