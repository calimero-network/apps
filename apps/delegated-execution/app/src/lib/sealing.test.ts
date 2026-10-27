import { DEFAULT_RELEASE_MIRROR, type DcapCollateral, type SignedNodeRelease } from '@calimero-network/mero-js';
import { verify as dcapVerify } from '@phala/dcap-qvl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeRelay } from './flow.js';
import published86 from './fixtures/mero-tee-v2.3.86.published-mrtds.json?raw';
import bundle86 from './fixtures/mero-tee-v2.3.86.published-mrtds.json.bundle.json?raw';
import published87 from './fixtures/mero-tee-v2.3.87.published-mrtds.json?raw';
import bundle87 from './fixtures/mero-tee-v2.3.87.published-mrtds.json.bundle.json?raw';
import tampered87 from './fixtures/mero-tee-v2.3.87.tampered.published-mrtds.json?raw';
import collateral from './fixtures/tdx_quote_collateral.json';
import quote from './fixtures/tdx_quote.json';
import { MIN_RELEASE_VERSION, relayQuoteVerifier, sealedRelayFetch, sealingErrorText } from './sealing.js';

// A real TDX quote and its Intel-signed collateral (dcap-qvl's sample, as
// mero-js tests it), verified at a moment inside the collateral's validity.
const QUOTE = Uint8Array.from(atob(quote.quoteB64), (c) => c.charCodeAt(0));
const COLLATERAL = collateral as unknown as DcapCollateral;
const AT = 1_751_000_000_000;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const td = dcapVerify(QUOTE, COLLATERAL, AT / 1000).report.data as { reportData: Uint8Array };
const ATTESTATION = {
  quoteB64: quote.quoteB64,
  nonce: hex(td.reportData.slice(0, 32)),
  reportDataSuffix: hex(td.reportData.slice(32)),
  collateral: COLLATERAL,
};

// Real mero-tee releases, as the node release workflow signed them and the
// mirror serves them: the file byte for byte, and its cosign bundle.
const R86: SignedNodeRelease = { version: '2.3.86', publishedMrtds: published86, bundle: bundle86 };
const R87: SignedNodeRelease = { version: '2.3.87', publishedMrtds: published87, bundle: bundle87 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the relay quote verifier', () => {
  it('checks the release signature and a real quote, then refuses an image not of that release', async () => {
    // The sample passes Intel's signature chain and the TCB appraisal; it
    // is not a mero-tee image, so the measurement check is what refuses it.
    const release = vi.fn(async () => R87);
    await expect(relayQuoteVerifier(dcapVerify, release, () => AT)(ATTESTATION)).rejects.toThrow(
      'are not an image this verifier trusts',
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it(`trusts ${MIN_RELEASE_VERSION}, the oldest release the page shipped with, as far as its quote`, async () => {
    expect(MIN_RELEASE_VERSION).toBe('2.3.86');
    await expect(relayQuoteVerifier(dcapVerify, async () => R86, () => AT)(ATTESTATION)).rejects.toThrow(
      'are not an image this verifier trusts',
    );
  });

  it('refuses a release that is not the signed one, before looking at the quote', async () => {
    const error = await relayQuoteVerifier(dcapVerify, async () => ({ ...R87, publishedMrtds: tampered87 }), () => AT)(
      ATTESTATION,
    ).catch((e: unknown) => e);
    expect(String(error)).toContain('SHA-256');
    expect(sealingErrorText(error)).toMatch(/not the one the mero-tee release workflow signed/);
    // A genuine file served under another release's name is refused the same way.
    await expect(
      relayQuoteVerifier(dcapVerify, async () => ({ ...R87, version: '2.3.88' }), () => AT)(ATTESTATION),
    ).rejects.toThrow('The signed release is 2.3.87, not 2.3.88');
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

  it('trusts the release the relay names, from the public mirror, and sends nothing on a mismatch', async () => {
    const relay = 'https://tee-relay.example';
    const calls: string[] = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const data =
          url === `${relay}/admin-api/tee/attest`
            ? { quoteB64: quote.quoteB64, quote: {}, transportPublicKey: '44'.repeat(32), collateral: COLLATERAL }
            : url === `${relay}/admin-api/tee/info`
              ? { osImage: 'merotee-ubuntu-questing-25-10-locked-read-only-2-3-87' }
              : url === `${DEFAULT_RELEASE_MIRROR}/api/tee/node-releases/2.3.87`
                ? R87
                : undefined;
        return data ? Response.json({ data }) : new Response('unexpected', { status: 500 });
      }),
    );

    const error = await sealedRelayFetch(relay)(`${relay}/admin-api/health`).catch((e: unknown) => e);
    expect(sealingErrorText(error)).toMatch(/not running the locked-read-only image of a signed mero-tee release/);
    expect(calls).toEqual([
      `${relay}/admin-api/tee/attest`,
      `${relay}/admin-api/tee/info`,
      `${DEFAULT_RELEASE_MIRROR}/api/tee/node-releases/2.3.87`,
    ]);
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
    expect(sealingErrorText(new Error('Release 2.3.85 is older than the minimum trusted, 2.3.86'))).toMatch(
      /older than 2\.3\.86, the oldest this page trusts/,
    );
    expect(
      sealingErrorText(new Error('The measurements (MRTD …) are not an image this verifier trusts')),
    ).toMatch(/not running the locked-read-only image of a signed mero-tee release/);
    const unreleased = '"merotee-ubuntu-questing-25-10-locked-read-only-2-3-88-dev"';
    expect(sealingErrorText(new Error(`${unreleased} is not the image of a mero-tee node release`))).toMatch(
      /not running the locked-read-only image/,
    );
    expect(
      sealingErrorText(new Error('The release was signed by "https://example.com", not by https://github.com/…')),
    ).toMatch(/not the one the mero-tee release workflow signed/);
    const mirror = `${DEFAULT_RELEASE_MIRROR}/api/tee/node-releases/2.3.87`;
    expect(sealingErrorText(new Error(`Fetching the node release from ${mirror} failed: HTTP 503`))).toMatch(
      /could not get the release.*Try again/s,
    );
    expect(sealingErrorText(new Error('HTTP 403: not a member'))).toBeNull();
  });
});
