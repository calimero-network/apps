/**
 * Which application a new workspace and its channels run.
 *
 * In v1 a node had chat installed under an application id, and a missing
 * install was offered to the user. On Calimero 1.0 a channel is created from
 * chat's package (or, under `vite`, the bundle `pnpm dev:local` uploaded), and
 * the cluster installs the package itself, so there is nothing to look up and
 * nothing to install from here. The names stay for the screens that call them.
 */
import { chatSource } from "../api/calimero";

/** Never thrown on Calimero 1.0; kept for the screens that test for it. */
export class AppNotInstalledError extends Error {
  readonly appId: string;

  constructor(appId: string) {
    super(`Application ${appId} is not installed.`);
    this.name = "AppNotInstalledError";
    this.appId = appId;
  }
}

/** The source new instances are created from: a bundle hash or `package[@version]`. */
function describeSource(): string {
  const source = chatSource();
  if (typeof source === "string") return source;
  return source.version ? `${source.package}@${source.version}` : source.package;
}

export async function resolveInstalledAppId(_preferred?: string): Promise<string> {
  return describeSource();
}

export async function installConfiguredApp(): Promise<string> {
  return describeSource();
}
