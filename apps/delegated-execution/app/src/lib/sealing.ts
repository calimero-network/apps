/**
 * Sealing the write to the relay's TEE, so only the attested enclave reads it.
 *
 * Unsealed, the warrant and the method's arguments cross the relay's TLS
 * terminator in the clear: anyone operating the load balancer, and anyone
 * holding the relay's certificate, reads what you wrote. Sealed, the page asks
 * the relay for a quote, verifies it HERE against Intel's root and against the
 * image of a signed mero-tee release, and encrypts every relay call to the key
 * that quote binds (Noise NK, `/sealed/v2`). The relay's proxy opens it inside
 * the TD.
 *
 * ## Which image, and why it can come from anywhere
 *
 * The relay names the release it runs (`GET /admin-api/tee/info`), and the page
 * fetches that release's `published-mrtds.json` and cosign bundle from the
 * public mirror. Neither is trusted. What is trusted is the signature: mero-js
 * checks it here, against the Sigstore root it embeds, and accepts only a file
 * the mero-tee node release workflow signed. A mirror that serves anything else
 * is refused, and one that serves nothing only stops the page sealing. A relay
 * that names the wrong release fails too: its quote must match all five
 * registers of the release it named.
 *
 * So a new release needs no new page, and a rollout does not strand it: a relay
 * on either side of an upgrade names its own release. What the relay does
 * choose is bounded by {@link MIN_RELEASE_VERSION}, since a signature never
 * expires and every release ever signed stays valid. Raise it when a release
 * must no longer be trusted.
 *
 * Only `locked-read-only` is trusted. The debug profiles have a shell, so their
 * operator can read the TD's memory, and sealing to one protects nothing.
 */

import {
  DEFAULT_RELEASE_MIRROR,
  cloudNodeReleaseUrl,
  createAttestedSealedFetch,
  createSignedReleaseVerifier,
  fetchNodeRelease,
  fetchNodeReleaseVersion,
  type DcapVerify,
  type QuoteVerifier,
  type SignedNodeRelease,
  type VerifyTransportQuote,
} from '@calimero-network/mero-js';

/** The one image profile trusted: no shell, so nobody reads the TD. */
export const TRUSTED_PROFILE = 'locked-read-only';

/** The oldest mero-tee release a relay may run: the oldest the page shipped with. */
export const MIN_RELEASE_VERSION = '2.3.86';

/**
 * The verifier for a relay's quote: the signature of the release `release`
 * returns, a release no older than {@link MIN_RELEASE_VERSION}, Intel's chain,
 * a TCB status that release accepts, all five registers of its image, and the
 * binding.
 *
 * `now` is for tests, which verify a sample quote at a moment inside its
 * collateral's validity.
 */
export function relayQuoteVerifier(
  dcapVerify: DcapVerify,
  release: () => Promise<SignedNodeRelease>,
  now?: () => number,
): QuoteVerifier {
  return createSignedReleaseVerifier({
    dcapVerify,
    release,
    profile: TRUSTED_PROFILE,
    minReleaseVersion: MIN_RELEASE_VERSION,
    ...(now ? { now } : {}),
  });
}

/** The signed release the relay says it runs, from the public mirror. Verified by the caller. */
async function relayRelease(baseUrl: string): Promise<SignedNodeRelease> {
  const version = await fetchNodeReleaseVersion(baseUrl);
  return fetchNodeRelease(cloudNodeReleaseUrl(DEFAULT_RELEASE_MIRROR, version));
}

/**
 * {@link relayQuoteVerifier} for the relay at `baseUrl`, with DCAP loaded on
 * the first quote it checks.
 *
 * `@phala/dcap-qvl` is most of this page's weight (it more than doubles the
 * bundle), and a visitor who never writes sealed never needs it. This is why
 * the page does not use `createSignedReleaseSealedFetch`, which takes DCAP up
 * front. mero-js calls the verifier asynchronously, so it can wait for the
 * import; it reads `includeCollateral` up front, so that is kept on the wrapper.
 */
let loadedDcap: Promise<DcapVerify> | undefined;

function lazyRelayQuoteVerifier(baseUrl: string): QuoteVerifier {
  const verify: VerifyTransportQuote = async (attestation) => {
    // A failed download is forgotten, so the next click tries again rather
    // than failing on a promise that rejected once.
    loadedDcap ??= import('@phala/dcap-qvl').then(
      ({ verify: dcapVerify }) => dcapVerify,
      (error: unknown) => {
        loadedDcap = undefined;
        throw error;
      },
    );
    return relayQuoteVerifier(await loadedDcap, () => relayRelease(baseUrl))(attestation);
  };
  return Object.assign(verify, { includeCollateral: true as const });
}

/**
 * One sealed fetch per relay, kept while it works.
 *
 * The sealed fetch attests the relay once and reuses the session, attesting
 * again only when the relay restarts. Building a new one per click would fetch
 * the release and verify a quote before every call.
 *
 * A call that fails drops it, so the next click attests afresh. The sealed
 * fetch keeps a failed attestation (a 502 while the relay restarts, a quote
 * that did not verify, a mirror that did not answer) and would otherwise
 * answer every later call with it until the page is reloaded.
 */
const sealedFetches = new Map<string, typeof fetch>();

export function sealedRelayFetch(relayUrl: string): typeof fetch {
  const baseUrl = relayUrl.replace(/\/+$/, '');
  const cached = sealedFetches.get(baseUrl);
  if (cached) return cached;
  const sealed = createAttestedSealedFetch({ baseUrl, verify: lazyRelayQuoteVerifier(baseUrl) });
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

/** How verifying a release's signature refuses one (mero-js's sigstore checks). */
const BAD_SIGNATURE = /^(The (release was signed|signed|signing|signature|detached|bundle|certificate|logged|file's SHA-256)\b|Rekor)/;

/**
 * What went wrong sealing, in terms of what to do about it.
 *
 * A relay that is not a TEE has no attestation route: write unsealed,
 * knowingly, or pick a TEE relay. A TEE on a release older than the minimum,
 * or whose quote is not the image of the release it names, is refused: the
 * page cannot tell a stale relay from one nobody should trust. A release the
 * mirror did not serve is worth a retry; one it served that does not verify is
 * not, since the page trusts no copy but the signed one.
 */
export function sealingErrorText(error: unknown): string | null {
  const message = reasonOf(error);
  if (/refused to attest|predates sealed transport/.test(message)) {
    return (
      'The relay did not attest: it is not a TEE node, or runs an image without sealed transport. ' +
      `Nothing was sent. Untick “Seal to the relay’s TEE” to write in the clear.\n\n${message}`
    );
  }
  if (/is older than the minimum trusted/.test(message)) {
    return (
      `The relay runs a mero-tee release older than ${MIN_RELEASE_VERSION}, the oldest this page ` +
      `trusts, so nothing was sent to it. Pick a relay on a newer release.\n\n${message}`
    );
  }
  if (/are not an image this verifier trusts|is not the image of a mero-tee node release/.test(message)) {
    return (
      `The relay is a TEE, but not running the ${TRUSTED_PROFILE} image of a signed mero-tee ` +
      `release, so nothing was sent to it.\n\n${message}`
    );
  }
  if (BAD_SIGNATURE.test(message)) {
    return (
      "The mirror's copy of the release the relay names is not the one the mero-tee release " +
      `workflow signed, so nothing was sent. Nobody should trust that copy.\n\n${message}`
    );
  }
  if (/node release from|did not answer with|did not name the node's image|\/admin-api\/tee\/info/.test(message)) {
    return (
      'The page could not get the release the relay runs, from the relay or from the mirror, so ' +
      `nothing was sent. Try again.\n\n${message}`
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
