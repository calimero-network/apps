/**
 * Sealing the write to the relay's TEE, so only the attested enclave reads it.
 *
 * Unsealed, the warrant and the method's arguments cross the relay's TLS
 * terminator in the clear: anyone operating the load balancer, and anyone
 * holding the relay's certificate, reads what you wrote. Sealed, the page asks
 * the relay for a quote, verifies it HERE against Intel's root and against the
 * images this page trusts, and encrypts every relay call to the key that quote
 * binds (Noise NK, `/sealed/v2`). The relay's proxy opens it inside the TD.
 *
 * ## Which images, and why they ship with the page
 *
 * The trusted images are the `published-mrtds.json` of the mero-tee node
 * releases in `src/trusted/`, checked in after verifying each one's Sigstore
 * signature (see the README). Fetching them at run time would trust whoever
 * serves them, which is the question the quote is meant to answer.
 *
 * Every release a relay may run is listed, so a rollout does not strand the
 * page: during an upgrade some relays run the old release and some the new one.
 * Drop a release once no relay runs it.
 *
 * Only `locked-read-only` is trusted. The debug profiles have a shell, so their
 * operator can read the TD's memory, and sealing to one protects nothing.
 */

import {
  createAttestedSealedFetch,
  createQuoteVerifier,
  trustedMeasurementsFromReleases,
  type DcapVerify,
  type PublishedMrtds,
  type QuoteVerifier,
  type VerifyTransportQuote,
} from '@calimero-network/mero-js';

import release2386 from '../trusted/mero-tee-v2.3.86.published-mrtds.json';
import release2387 from '../trusted/mero-tee-v2.3.87.published-mrtds.json';

/** The node releases a relay may run, oldest first. */
export const TRUSTED_RELEASES: readonly PublishedMrtds[] = [release2386, release2387];

/** The one image profile trusted: no shell, so nobody reads the TD. */
export const TRUSTED_PROFILE = 'locked-read-only';

/** "2.3.86 or 2.3.87", for the page to say what it trusts. */
export const TRUSTED_RELEASE_NAMES = TRUSTED_RELEASES.map((release) => release.tag ?? '?').join(' or ');

/**
 * The verifier for a relay's quote: Intel's chain, a TCB status every trusted
 * release accepts, all five registers of one trusted image, and the binding.
 *
 * `now` is for tests, which verify a sample quote at a moment inside its
 * collateral's validity.
 */
export function relayQuoteVerifier(dcapVerify: DcapVerify, now?: () => number): QuoteVerifier {
  return createQuoteVerifier({
    dcapVerify,
    ...trustedMeasurementsFromReleases([...TRUSTED_RELEASES], { profile: TRUSTED_PROFILE }),
    ...(now ? { now } : {}),
  });
}

/**
 * {@link relayQuoteVerifier}, with DCAP loaded on the first quote it checks.
 *
 * `@phala/dcap-qvl` is most of this page's weight (it more than doubles the
 * bundle), and a visitor who never writes sealed never needs it. mero-js calls
 * the verifier asynchronously, so it can wait for the import; it reads
 * `includeCollateral` up front, so that is kept on the wrapper.
 */
let loadedVerifier: Promise<QuoteVerifier> | undefined;

function lazyRelayQuoteVerifier(): QuoteVerifier {
  const verify: VerifyTransportQuote = async (attestation) => {
    // A failed download is forgotten, so the next click tries again rather
    // than failing on a promise that rejected once.
    loadedVerifier ??= import('@phala/dcap-qvl').then(
      ({ verify: dcapVerify }) => relayQuoteVerifier(dcapVerify),
      (error: unknown) => {
        loadedVerifier = undefined;
        throw error;
      },
    );
    return (await loadedVerifier)(attestation);
  };
  return Object.assign(verify, { includeCollateral: true as const });
}

/**
 * One sealed fetch per relay, kept while it works.
 *
 * The sealed fetch attests the relay once and reuses the session, attesting
 * again only when the relay restarts. Building a new one per click would fetch
 * and verify a quote before every call.
 *
 * A call that fails drops it, so the next click attests afresh. The sealed
 * fetch keeps a failed attestation (a 502 while the relay restarts, a quote
 * that did not verify) and would otherwise answer every later call with it
 * until the page is reloaded.
 */
const sealedFetches = new Map<string, typeof fetch>();

export function sealedRelayFetch(relayUrl: string): typeof fetch {
  const baseUrl = relayUrl.replace(/\/+$/, '');
  const cached = sealedFetches.get(baseUrl);
  if (cached) return cached;
  const sealed = createAttestedSealedFetch({ baseUrl, verify: lazyRelayQuoteVerifier() });
  const kept: typeof fetch = async (input, init) => {
    try {
      return await sealed(input, init);
    } catch (error) {
      if (sealedFetches.get(baseUrl) === kept) sealedFetches.delete(baseUrl);
      throw error;
    }
  };
  sealedFetches.set(baseUrl, kept);
  return kept;
}

/**
 * What went wrong sealing, in terms of what to do about it.
 *
 * The two a person hits are different fixes. A relay that is not a TEE has no
 * attestation route: write unsealed, knowingly, or pick a TEE relay. A TEE that
 * runs an image this page does not trust is either a release newer than the
 * page (update `src/trusted/`) or an image nobody should trust, and the page
 * cannot tell which, so it refuses.
 */
export function sealingErrorText(error: unknown): string | null {
  const message = reasonOf(error);
  if (/are not an image this verifier trusts/.test(message)) {
    return (
      `The relay is a TEE, but not running a ${TRUSTED_PROFILE} image of mero-tee ` +
      `${TRUSTED_RELEASE_NAMES}, so nothing was sent to it. If it runs a newer release, add that ` +
      `release to src/trusted/ (see the README).\n\n${message}`
    );
  }
  if (/refused to attest|predates sealed transport/.test(message)) {
    return (
      'The relay did not attest: it is not a TEE node, or runs an image without sealed transport. ' +
      `Nothing was sent. Untick “Seal to the relay’s TEE” to write in the clear.\n\n${message}`
    );
  }
  return null;
}

/**
 * The reason a relay call failed. `RelayClient` reports a fetch that threw --
 * which is how the sealed fetch refuses -- as `HTTP 0`, with the reason in
 * `bodyText` rather than in the message.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const body = (error as { bodyText?: unknown }).bodyText;
  return typeof body === 'string' && body !== '' ? body : error.message;
}
