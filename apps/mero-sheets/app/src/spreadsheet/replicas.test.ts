import { describe, expect, it, vi } from 'vitest';
import {
  NO_REPLICA_POLICY, isTeeRole, replicaPolicyFrom, replicaPolicyRequest, storeReplicaPolicy, teeRoleLabel, type ReplicaPolicy,
} from './replicas';

const lists = { allowedMrtd: [], allowedRtmr0: [], allowedRtmr1: [], allowedRtmr2: [], allowedRtmr3: [] };

describe('replica admission policy', () => {
  it('stores the signed-release form, never measurement lists', () => {
    // The node refuses an MRTD-only list: the MRTD is the TD firmware, which
    // every image shares, so it would admit a debug image as a locked one.
    const request = replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: '2.3.86', legacyMeasurements: 0, mode: 'relay' });
    expect(request).toEqual({
      signedRelease: { allowedProfiles: ['locked-read-only'], minReleaseVersion: '2.3.86' },
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
      mode: 'relay',
    });
    expect(request).not.toHaveProperty('allowedMrtd');
  });

  it('admits any signed release when no minimum is given, and drops a leading v', () => {
    expect(replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: null, legacyMeasurements: 0, mode: 'relay' }).signedRelease)
      .toEqual({ allowedProfiles: ['locked-read-only'] });
    expect(replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: 'v2.3.87', legacyMeasurements: 0, mode: 'relay' }).signedRelease)
      .toEqual({ allowedProfiles: ['locked-read-only'], minReleaseVersion: '2.3.87' });
  });

  it('refuses a policy that would admit nothing, or names no release', () => {
    expect(() => replicaPolicyRequest(NO_REPLICA_POLICY)).toThrow(/at least one image profile/);
    expect(() => replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: 'latest', legacyMeasurements: 0, mode: 'relay' }))
      .toThrow(/not a release version/);
  });

  it('reads a signed-release policy back as the panel shows it', () => {
    expect(replicaPolicyFrom({
      ...lists,
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
      signedRelease: { allowedProfiles: ['locked-read-only', 'debug-read-only'], minReleaseVersion: '2.3.86' },
      mode: 'relay',
    })).toEqual({ profiles: ['locked-read-only', 'debug-read-only'], minRelease: '2.3.86', legacyMeasurements: 0, mode: 'relay' });
  });

  it('reads a policy with no mode, from a node older than rc.61, as admitting replicas', () => {
    expect(replicaPolicyFrom({
      ...lists,
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
      signedRelease: { allowedProfiles: ['locked-read-only'] },
    }).mode).toBe('replica');
  });

  it('shows a hand-listed policy as one to replace, not as admitting', () => {
    const policy = replicaPolicyFrom({ ...lists, allowedMrtd: ['aa', 'bb'], allowedTcbStatuses: ['UpToDate'], acceptMock: false });
    expect(policy).toEqual({ profiles: [], minRelease: null, legacyMeasurements: 2, mode: 'replica' });
  });

  it('admits relays when nothing is stored yet', () => {
    expect(NO_REPLICA_POLICY.mode).toBe('relay');
  });
});

describe('TEE roles', () => {
  it('counts a relay and a replica as TEEs, and nothing else', () => {
    expect(isTeeRole('RelayTee')).toBe(true);
    expect(isTeeRole('ReadOnlyTee')).toBe(true);
    for (const role of ['Admin', 'Member', 'ReadOnly']) expect(isTeeRole(role)).toBe(false);
  });

  it('labels each TEE role', () => {
    expect(teeRoleLabel('RelayTee')).toBe('TEE relay');
    expect(teeRoleLabel('ReadOnlyTee')).toBe('Always-on replica');
    expect(teeRoleLabel('ReadOnly')).toBeNull();
  });
});

describe('storing the policy', () => {
  const relays: ReplicaPolicy = { profiles: ['locked-read-only'], minRelease: null, legacyMeasurements: 0, mode: 'relay' };
  const refusal = Object.assign(new Error('HTTP 400'), {
    status: 400,
    bodyText: 'Failed to deserialize the JSON body: unknown field `mode`, expected one of `allowedMrtd`, …',
  });

  it('sends the mode, and says nothing when the node takes it', async () => {
    const setTeeAdmissionPolicy = vi.fn().mockResolvedValue(undefined);
    expect(await storeReplicaPolicy({ setTeeAdmissionPolicy }, 'ns', relays)).toEqual({ stored: relays, warning: null });
    expect(setTeeAdmissionPolicy).toHaveBeenCalledTimes(1);
    expect(setTeeAdmissionPolicy.mock.calls[0][1]).toMatchObject({ mode: 'relay' });
  });

  it('retries once without the mode on a node that refuses it, and warns that relays need rc.61', async () => {
    const setTeeAdmissionPolicy = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue(undefined);
    const { stored, warning } = await storeReplicaPolicy({ setTeeAdmissionPolicy }, 'ns', relays);
    expect(setTeeAdmissionPolicy).toHaveBeenCalledTimes(2);
    expect(setTeeAdmissionPolicy.mock.calls[1][1]).not.toHaveProperty('mode');
    expect(stored.mode).toBe('replica');
    expect(warning).toMatch(/0\.11\.0-rc\.61/);
  });

  it('does not warn when a replica was asked for anyway', async () => {
    const setTeeAdmissionPolicy = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue(undefined);
    const { warning } = await storeReplicaPolicy({ setTeeAdmissionPolicy }, 'ns', { ...relays, mode: 'replica' });
    expect(warning).toBeNull();
  });

  it('passes on any other refusal without retrying', async () => {
    const forbidden = Object.assign(new Error('HTTP 403'), { status: 403, bodyText: 'not an admin' });
    const setTeeAdmissionPolicy = vi.fn().mockRejectedValue(forbidden);
    await expect(storeReplicaPolicy({ setTeeAdmissionPolicy }, 'ns', relays)).rejects.toBe(forbidden);
    expect(setTeeAdmissionPolicy).toHaveBeenCalledTimes(1);
  });
});
