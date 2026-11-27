/**
 * The name a passkey is listed under in a password manager or the OS: who it
 * is for, which app made it, and which cluster it works on, so a person with
 * several can tell them apart. Every Calimero cluster shares one rp id, so the
 * name is the only thing that tells them apart.
 *
 * The node names the passkey (`user.name` and `user.displayName` in its
 * registration options) as `Alex · Sylence (eu-shared-1 · 3f2a)`, or `Alex ·
 * eu-shared-1 · 3f2a` when the page is not one of a package's frontends, and
 * an older node only `Alex`. {@link appNamedPasskey} adds the app where the
 * node left it out, in the node's own format.
 */
import type { PasskeyProvider, SignUpPolicy } from "@calimero-network/mero-js";
import { targetKey, type KeyValueStorage, type Target } from "@calimero-apps/connect";
import { appNameFromTitle } from "./upgrade";

/** The node's name for an account created with no name. */
export const UNNAMED_ACCOUNT = "Calimero user";

/** The most characters a passkey name takes of each part, as the node clips them. */
export const PASSKEY_NAME_PART_CHARS = 32;

function clip(s: string): string {
  const t = s.trim();
  return [...t].length <= PASSKEY_NAME_PART_CHARS ? t : `${[...t].slice(0, PASSKEY_NAME_PART_CHARS - 1).join("")}…`;
}

/**
 * The cluster as a passkey name says it: the policy's `cluster` and
 * `passkeyTag` (`eu-shared-1 · 3f2a`) when read, else the target's cluster,
 * or `local` for `merod local`.
 */
export function passkeyCluster(target: Target, policy?: Pick<SignUpPolicy, "cluster" | "passkeyTag"> | null): string {
  const cluster = policy?.cluster || (target.kind === "local" ? "local" : target.cluster);
  const tag = policy?.passkeyTag;
  return tag ? `${clip(cluster)} · ${tag}` : clip(cluster);
}

/** `Alex · Sylence (eu-shared-1 · 3f2a)`; without an app, `Alex · eu-shared-1 · 3f2a`. */
export function passkeyName(person: string, cluster: string, app?: string | null): string {
  const who = clip(person) || UNNAMED_ACCOUNT;
  return app ? `${who} · ${clip(app)} (${cluster})` : `${who} · ${cluster}`;
}

/** The app's name for its passkeys: `appName`, else the page title's first part. */
export function passkeyAppName(appName?: string | null): string | null {
  if (appName !== undefined) return appName?.trim() || null;
  const doc = (globalThis as { document?: { title?: string } }).document;
  return appNameFromTitle(doc?.title);
}

/** The name the node gave, with the app added where it left it out. */
export function withAppName(shown: string, person: string, cluster: string, app: string | null): string {
  const who = clip(person) || UNNAMED_ACCOUNT;
  // An older node: the person's name alone.
  if (shown === who || shown === person.trim()) return passkeyName(person, cluster, app);
  if (!app) return shown;
  const lead = `${who} · `;
  // The node's name without an app: `Alex · eu-shared-1 · 3f2a`.
  if (shown.startsWith(lead) && !shown.includes("(")) return `${lead}${clip(app)} (${shown.slice(lead.length)})`;
  return shown;
}

/**
 * `passkey`, creating passkeys under {@link withAppName}'s name: the app and
 * the cluster in it whatever the node answers. Only the name shown changes;
 * `user.id` and everything the node checks are the node's.
 */
export function appNamedPasskey(
  passkey: PasskeyProvider,
  { person, cluster, app }: { person: string; cluster: string; app: string | null },
): PasskeyProvider {
  return {
    create: (options, createOptions) => {
      const user = options.user as { name?: unknown } | undefined;
      if (!user || typeof user.name !== "string") return passkey.create(options, createOptions);
      const name = withAppName(user.name, person, cluster, app);
      return passkey.create({ ...options, user: { ...user, name, displayName: name } }, createOptions);
    },
    get: (challenge, rpId, allowCredentials, options) => passkey.get(challenge, rpId, allowCredentials, options),
  };
}

/** Where a browser keeps the name last given at a sign-up on `target`, to suggest it next time. */
export function signUpNameKey(target: Target): string {
  return `calimero-sign-up-name:${targetKey(target)}`;
}

function pageStorage(storage: KeyValueStorage | undefined): KeyValueStorage | undefined {
  if (storage) return storage;
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/** The name last given at a sign-up on `target` in this browser, if any. */
export function rememberedSignUpName(target: Target, storage?: KeyValueStorage): string {
  try {
    return pageStorage(storage)?.getItem(signUpNameKey(target))?.trim() ?? "";
  } catch {
    return "";
  }
}

export function rememberSignUpName(target: Target, name: string, storage?: KeyValueStorage): void {
  if (!name.trim()) return;
  try {
    pageStorage(storage)?.setItem(signUpNameKey(target), name.trim());
  } catch {
    // Storage blocked: nothing is suggested next time.
  }
}
