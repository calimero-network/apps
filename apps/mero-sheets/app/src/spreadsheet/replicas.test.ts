import { describe, expect, it } from 'vitest';
import { NO_REPLICA_POLICY, replicaPolicyFrom, replicaPolicyRequest } from './replicas';

const lists = { allowedMrtd: [], allowedRtmr0: [], allowedRtmr1: [], allowedRtmr2: [], allowedRtmr3: [] };

describe('replica admission policy', () => {
  it('stores the signed-release form, never measurement lists', () => {
    // The node refuses an MRTD-only list: the MRTD is the TD firmware, which
    // every image shares, so it would admit a debug image as a locked one.
    const request = replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: '2.3.86', legacyMeasurements: 0 });
    expect(request).toEqual({
      signedRelease: { allowedProfiles: ['locked-read-only'], minReleaseVersion: '2.3.86' },
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
    });
    expect(request).not.toHaveProperty('allowedMrtd');
  });

  it('admits any signed release when no minimum is given, and drops a leading v', () => {
    expect(replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: null, legacyMeasurements: 0 }).signedRelease)
      .toEqual({ allowedProfiles: ['locked-read-only'] });
    expect(replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: 'v2.3.87', legacyMeasurements: 0 }).signedRelease)
      .toEqual({ allowedProfiles: ['locked-read-only'], minReleaseVersion: '2.3.87' });
  });

  it('refuses a policy that would admit nothing, or names no release', () => {
    expect(() => replicaPolicyRequest(NO_REPLICA_POLICY)).toThrow(/at least one image profile/);
    expect(() => replicaPolicyRequest({ profiles: ['locked-read-only'], minRelease: 'latest', legacyMeasurements: 0 }))
      .toThrow(/not a release version/);
  });

  it('reads a signed-release policy back as the panel shows it', () => {
    expect(replicaPolicyFrom({
      ...lists,
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
      signedRelease: { allowedProfiles: ['locked-read-only', 'debug-read-only'], minReleaseVersion: '2.3.86' },
    })).toEqual({ profiles: ['locked-read-only', 'debug-read-only'], minRelease: '2.3.86', legacyMeasurements: 0 });
  });

  it('shows a hand-listed policy as one to replace, not as admitting', () => {
    const policy = replicaPolicyFrom({ ...lists, allowedMrtd: ['aa', 'bb'], allowedTcbStatuses: ['UpToDate'], acceptMock: false });
    expect(policy).toEqual({ profiles: [], minRelease: null, legacyMeasurements: 2 });
  });
});
