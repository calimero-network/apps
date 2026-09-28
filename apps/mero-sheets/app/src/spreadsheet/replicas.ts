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
  GetTeeAdmissionPolicyResponseData,
  SignedReleaseTeeAdmissionPolicyRequest,
} from '@calimero-network/mero-js';

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
export function replicaPolicyFrom(stored: GetTeeAdmissionPolicyResponseData): ReplicaPolicy {
  if (stored.signedRelease) {
    return {
      profiles: stored.signedRelease.allowedProfiles,
      minRelease: stored.signedRelease.minReleaseVersion ?? null,
      legacyMeasurements: 0,
    };
  }
  return { profiles: [], minRelease: null, legacyMeasurements: stored.allowedMrtd.length };
}

/** No policy stored, or none readable: nothing is admitted. */
export const NO_REPLICA_POLICY: ReplicaPolicy = { profiles: [], minRelease: null, legacyMeasurements: 0 };

/** The request that stores `policy`. Throws for one that would admit nothing. */
export function replicaPolicyRequest(policy: ReplicaPolicy): SignedReleaseTeeAdmissionPolicyRequest {
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
  };
}
