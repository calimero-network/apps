/**
 * The workspace's replica admission policy, in the one form a node will store.
 *
 * Core refuses a policy that pins a TEE by its MRTD alone: the MRTD measures
 * the TD firmware, which every image and profile shares, so it admits a debug
 * image as readily as a locked one. A hand-listed policy has to pin RTMR1-3
 * too, and those change with every release. The signed-release form avoids
 * both: the node checks the replica's quote against the `published-mrtds.json`
 * of the release it runs, signed by the mero-tee release workflow.
 */
import type {
  AdminApiClient,
  GetTeeAdmissionPolicyResponseData,
  SignedReleaseTeeAdmissionPolicyRequest,
} from '@calimero-network/mero-js';

/**
 * The role an admitted TEE takes. A `relay` (core's `RelayTee`) also runs
 * members' delegated writes, which is what a cloud TEE is for; a `replica`
 * (`ReadOnlyTee`) only holds and serves the data. Absent means `replica`.
 */
export type TeeMode = 'relay' | 'replica';

// The installed mero-js types predate the policy's `mode` (core
// 0.11.0-rc.62); these two extend them by that one field until a release
// carries it.
type StoredTeeAdmissionPolicy = GetTeeAdmissionPolicyResponseData & { mode?: TeeMode };
type TeeAdmissionPolicyRequest = SignedReleaseTeeAdmissionPolicyRequest & { mode?: TeeMode };

/** Core's roles for an attested TEE member: either one is a TEE. */
export function isTeeRole(role: string): boolean {
  return role === 'ReadOnlyTee' || role === 'RelayTee';
}

/** How a TEE role reads in the roster, or null for a role that is not one. */
export function teeRoleLabel(role: string): string | null {
  if (role === 'RelayTee') return 'TEE relay';
  if (role === 'ReadOnlyTee') return 'Always-on replica';
  return null;
}

/**
 * The workspace's rule for admitting always-on replicas.
 *
 * By signed release: a replica is admitted when it runs a mero-tee release the
 * release workflow signed, and its attested measurements are that release's
 * for one of `profiles`. Nobody types a measurement, and nothing needs editing
 * when a new release ships.
 */
export interface ReplicaPolicy {
  /** Image profiles admitted; none means no replica is admitted. */
  profiles: string[];
  /** The oldest release admitted (`2.3.86`), or null for any signed release. */
  minRelease: string | null;
  /**
   * How many measurements a hand-listed policy names, when the stored policy
   * is one. Nodes refuse to store that form now unless it pins the whole image
   * (RTMR1-3 as well as the MRTD), which this panel never asked for, so it is
   * shown only to be replaced.
   */
  legacyMeasurements: number;
  /** The role admitted TEEs take. */
  mode: TeeMode;
}

/** The profiles a replica may run, safest first. */
export const REPLICA_PROFILES: { value: string; label: string; help: string }[] = [
  {
    value: 'locked-read-only',
    label: 'Production (locked-read-only)',
    help: 'No shell and no way in: what the replica runs is exactly what the release measured.',
  },
  {
    value: 'debug-read-only',
    label: 'Debug (debug-read-only)',
    help: 'Has a debug shell, so its operator can read the data. For testing only.',
  },
];


/** Whether `value` names a release, as `2.3.86` or `v2.3.86`. */
export function isReleaseVersion(value: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(value.trim());
}

/** The policy as the panel shows it, from what the node stored. */
export function replicaPolicyFrom(stored: StoredTeeAdmissionPolicy): ReplicaPolicy {
  // A node older than rc.62 leaves `mode` out, and admits replicas.
  const mode = stored.mode ?? 'replica';
  if (stored.signedRelease) {
    return {
      profiles: stored.signedRelease.allowedProfiles,
      minRelease: stored.signedRelease.minReleaseVersion ?? null,
      legacyMeasurements: 0,
      mode,
    };
  }
  return { profiles: [], minRelease: null, legacyMeasurements: stored.allowedMrtd.length, mode };
}

/** No policy stored, or none readable: nothing is admitted, and relays are what to admit. */
export const NO_REPLICA_POLICY: ReplicaPolicy = { profiles: [], minRelease: null, legacyMeasurements: 0, mode: 'relay' };

/** The request that stores `policy`. Throws for one that would admit nothing. */
export function replicaPolicyRequest(policy: ReplicaPolicy): TeeAdmissionPolicyRequest {
  if (policy.profiles.length === 0) {
    throw new Error('Choose at least one image profile to admit');
  }
  if (policy.minRelease !== null && !isReleaseVersion(policy.minRelease)) {
    throw new Error(`${policy.minRelease} is not a release version, like 2.3.86`);
  }
  return {
    signedRelease: {
      allowedProfiles: policy.profiles,
      ...(policy.minRelease ? { minReleaseVersion: policy.minRelease.replace(/^v/, '') } : {}),
    },
    allowedTcbStatuses: ['UpToDate'],
    acceptMock: false,
    mode: policy.mode,
  };
}

/** Whether `err` is a node refusing the policy's `mode` field, as one older than rc.62 does. */
function refusesMode(err: unknown): boolean {
  const e = err as { status?: unknown; bodyText?: unknown; message?: unknown } | null;
  if (e?.status !== 400) return false;
  return /\bmode\b|unknown field/i.test(`${String(e.bodyText ?? '')} ${String(e.message ?? '')}`);
}

/**
 * Store `policy` on the namespace `groupId`, and say what the node stored.
 *
 * A node older than core 0.11.0-rc.62 refuses the `mode` field outright, so a
 * refusal naming it is retried once without it: that node admits replicas
 * whatever was asked, and the warning says so when relays were.
 */
export async function storeReplicaPolicy(
  admin: Pick<AdminApiClient, 'setTeeAdmissionPolicy'>,
  groupId: string,
  policy: ReplicaPolicy,
): Promise<{ stored: ReplicaPolicy; warning: string | null }> {
  const request = replicaPolicyRequest(policy);
  try {
    await admin.setTeeAdmissionPolicy(groupId, request);
    return { stored: policy, warning: null };
  } catch (err) {
    if (!refusesMode(err)) throw err;
  }
  const { mode: _refused, ...withoutMode } = request;
  await admin.setTeeAdmissionPolicy(groupId, withoutMode);
  return {
    stored: { ...policy, mode: 'replica' },
    warning: policy.mode === 'relay'
      ? 'This node admits TEEs only as replicas, which do not relay members\' writes. Relays need core 0.11.0-rc.62 or newer.'
      : null,
  };
}
