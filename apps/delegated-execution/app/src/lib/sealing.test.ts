import { trustedMeasurementsFromReleases, type DcapCollateral } from '@calimero-network/mero-js';
import { verify as dcapVerify } from '@phala/dcap-qvl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeRelay } from './flow.js';
import collateral from './fixtures/tdx_quote_collateral.json';
import quote from './fixtures/tdx_quote.json';
import {
  TRUSTED_PROFILE,
  TRUSTED_RELEASES,
  TRUSTED_RELEASE_NAMES,
  relayQuoteVerifier,
  sealedRelayFetch,
  sealingErrorText,
} from './sealing.js';

// A real TDX quote and its Intel-signed collateral (dcap-qvl's sample, as
// mero-js tests it), verified at a moment inside the collateral's validity.
const QUOTE = Uint8Array.from(atob(quote.quoteB64), (c) => c.charCodeAt(0));
const COLLATERAL = collateral as unknown as DcapCollateral;
const AT = 1_751_000_000_000;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const td = dcapVerify(QUOTE, COLLATERAL, AT / 1000).report.data as { reportData: Uint8Array };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the trusted releases', () => {
  it('are node releases, named as their files say, with the production profile', () => {
    expect(TRUSTED_RELEASES.map((r) => [r.role, r.tag])).toEqual([
      ['node', '2.3.86'],
      ['node', '2.3.87'],
    ]);
    expect(TRUSTED_RELEASE_NAMES).toBe('2.3.86 or 2.3.87');
    for (const release of TRUSTED_RELEASES) expect(release.profiles[TRUSTED_PROFILE]).toBeDefined();
  });

  it('trust each release as a whole image, and nothing but locked-read-only', () => {
    // Both releases, so a relay mid-upgrade verifies on either side of it.
    const { allowedMeasurements } = trustedMeasurementsFromReleases([...TRUSTED_RELEASES], { profile: TRUSTED_PROFILE });
    expect(allowedMeasurements).toHaveLength(2);
    // The MRTD is the TD firmware, shared by every image: RTMR1-3 are what differ.
    expect(new Set(allowedMeasurements.map((m) => m.mrtd)).size).toBe(1);
    expect(new Set(allowedMeasurements.map((m) => m.rtmr3)).size).toBe(2);
    const debug = TRUSTED_RELEASES.flatMap((r) => [r.profiles['debug']?.rtmr3, r.profiles['debug-read-only']?.rtmr3]);
    for (const image of allowedMeasurements) expect(debug).not.toContain(image.rtmr3);
  });
});

describe('the relay quote verifier', () => {
  it('checks a real quote against Intel, then refuses an image it does not trust', async () => {
    // The sample passes the signature chain, the TCB appraisal and the binding;
    // it is not a mero-tee image, so the measurement check is what refuses it.
    await expect(
      relayQuoteVerifier(dcapVerify, () => AT)({
        quoteB64: quote.quoteB64,
        nonce: hex(td.reportData.slice(0, 32)),
        reportDataSuffix: hex(td.reportData.slice(32)),
        collateral: COLLATERAL,
      }),
    ).rejects.toThrow('are not an image this verifier trusts');
  });

  it('refuses a quote that does not commit to this request', async () => {
    await expect(
      relayQuoteVerifier(dcapVerify, () => AT)({
        quoteB64: quote.quoteB64,
        nonce: '00'.repeat(32),
        reportDataSuffix: hex(td.reportData.slice(32)),
        collateral: COLLATERAL,
      }),
    ).rejects.toThrow();
  });
});

describe('a sealed relay call', () => {
  it('sends nothing to a relay that cannot attest', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('not found', { status: 404 });
      }),
    );

    const refused = describeRelay('https://plain-relay.example/', 'ab'.repeat(32), { seal: true });

    // RelayClient reports the refusal as `HTTP 0`; the page names it from the reason.
    const error = await refused.catch((e: unknown) => e);
    expect(sealingErrorText(error)).toMatch(/not a TEE node.*refused to attest: HTTP 404/s);
    // Only the attestation was asked for; the intents route was never reached.
    expect(calls).toEqual(['https://plain-relay.example/admin-api/tee/attest']);
  });

  it('attests again after a failure, rather than keeping it until a reload', async () => {
    let attests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attests += 1;
        return new Response('restarting', { status: 502 });
      }),
    );
    const first = sealedRelayFetch('https://restarting-relay.example');
    await expect(first('https://restarting-relay.example/admin-api/health')).rejects.toThrow('refused to attest');

    const second = sealedRelayFetch('https://restarting-relay.example');
    expect(second).not.toBe(first);
    await expect(second('https://restarting-relay.example/admin-api/health')).rejects.toThrow('refused to attest');
    expect(attests).toBe(2);
  });

  it('attests a relay once for the page, not before every call', () => {
    expect(sealedRelayFetch('https://relay.example/')).toBe(sealedRelayFetch('https://relay.example'));
    expect(sealedRelayFetch('https://relay.example')).not.toBe(sealedRelayFetch('https://other.example'));
  });
});

describe('sealing errors', () => {
  it('name what to do about each', () => {
    expect(sealingErrorText(new Error('The node refused to attest: HTTP 404'))).toMatch(/not a TEE node.*Untick/s);
    expect(
      sealingErrorText(new Error('The measurements (MRTD …) are not an image this verifier trusts')),
    ).toMatch(/not running a locked-read-only image of mero-tee 2\.3\.86 or 2\.3\.87.*src\/trusted/s);
    expect(sealingErrorText(new Error('HTTP 403: not a member'))).toBeNull();
  });
});
