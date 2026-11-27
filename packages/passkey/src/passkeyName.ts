/**
 * The name a passkey is listed under in a password manager or the OS: an
 * optional label the person gives it ("Work laptop"), the app that made it,
 * and the cluster it works on. Every Calimero cluster shares one rp id, so
 * the name is the only thing that tells a person's passkeys apart.
 *
 * The node names the passkey (`user.name` and `user.displayName` in its
 * registration options) after the account's name: `Calimero user · Sylence
 * (eu-shared-1 · 3f2a)`, or `Calimero user · eu-shared-1 · 3f2a` when the page
 * is not one of a package's frontends, and an older node only `Calimero user`.
 * {@link labelledPasskey} replaces that with `Work laptop · Sylence
 * (eu-shared-1 · 3f2a)`, or `Sylence (eu-shared-1 · 3f2a)` without a label.
 * The label never reaches the node: the account's name (which an app may show
 * as the person's name) stays what the sign-up sent.
 */
import type { PasskeyProvider, SignUpPolicy } from "@calimero-network/mero-js";
import type { Target } from "@calimero-apps/connect";
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

/**
 * `Work laptop · Sylence (eu-shared-1 · 3f2a)`; without a label `Sylence
 * (eu-shared-1 · 3f2a)`; without an app `Work laptop · eu-shared-1 · 3f2a`.
 */
export function passkeyName(label: string, cluster: string, app?: string | null): string {
  const base = app ? `${clip(app)} (${cluster})` : cluster;
  return label.trim() ? `${clip(label)} · ${base}` : base;
}

/** The app's name for its passkeys: `appName`, else the page title's first part. */
export function passkeyAppName(appName?: string | null): string | null {
  if (appName !== undefined) return appName?.trim() || null;
  const doc = (globalThis as { document?: { title?: string } }).document;
  return appNameFromTitle(doc?.title);
}

export interface PasskeyNaming {
  /** The account's name the sign-up sent the node (`""` for none). */
  person: string;
  /** The person's label for this passkey (`""` for none); client-side only. */
  label: string;
  cluster: string;
  app: string | null;
}

/**
 * The name to show for a passkey the node named `shown`: its app and cluster
 * (the node's where it gave them), led by the label, else by the account's
 * name when the sign-up sent one, never by {@link UNNAMED_ACCOUNT}.
 */
export function labelledName(shown: string, { person, label, cluster, app }: PasskeyNaming): string {
  const who = clip(person) || UNNAMED_ACCOUNT;
  const lead = label.trim() || person.trim();
  let base: string;
  if (shown === who || shown === person.trim()) {
    // A node before passkey names: the account's name alone.
    base = passkeyName("", cluster, app);
  } else if (shown.startsWith(`${who} · `)) {
    const rest = shown.slice(who.length + 3);
    // Without an app (a page that is not a package's frontend), the app goes in.
    base = app && !rest.includes("(") ? `${clip(app)} (${rest})` : rest;
  } else {
    return lead ? `${clip(lead)} · ${shown}` : shown;
  }
  return passkeyName(lead, base);
}

/**
 * `passkey`, creating passkeys under {@link labelledName}'s name. Only the
 * name shown changes; `user.id` and everything the node checks are the node's.
 */
export function labelledPasskey(passkey: PasskeyProvider, naming: PasskeyNaming): PasskeyProvider {
  return {
    create: (options, createOptions) => {
      const user = options.user as { name?: unknown } | undefined;
      if (!user || typeof user.name !== "string") return passkey.create(options, createOptions);
      const name = labelledName(user.name, naming);
      return passkey.create({ ...options, user: { ...user, name, displayName: name } }, createOptions);
    },
    get: (challenge, rpId, allowCredentials, options) => passkey.get(challenge, rpId, allowCredentials, options),
  };
}
