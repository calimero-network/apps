import { resolveMpk, startRig } from "./rig";

export default async function journeyGlobalSetup(): Promise<void> {
  const dataDir = process.env["JOURNEY_DATA_DIR"];
  const appDir = process.env["JOURNEY_APP_DIR"];
  const packageId = process.env["JOURNEY_PACKAGE_ID"];
  if (!dataDir || !appDir || !packageId) {
    throw new Error("journey global setup needs JOURNEY_DATA_DIR, JOURNEY_APP_DIR and JOURNEY_PACKAGE_ID (set by journeyConfig)");
  }
  const mpk = resolveMpk(appDir, packageId);
  const state = await startRig({ dataDir, mpk, nodes: 2 });
  console.log(
    `[journey] ${state.merodVersion}; ${state.nodes
      .map((n) => `${n.name} ${n.url} app=${n.applicationId.slice(0, 8)}…`)
      .join(", ")}`,
  );
}
