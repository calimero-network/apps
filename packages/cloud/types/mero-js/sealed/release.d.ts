/**
 * Trusting a TEE node's image by its signed release, fetched at run time from
 * anywhere, instead of shipping the release's `published-mrtds.json` with the
 * app.
 *
 * Each mero-tee node release publishes `published-mrtds.json` (the
 * measurements of its image) with a cosign keyless bundle, signed by the
 * mero-tee release workflow on GitHub Actions. {@link verifySignedNodeRelease}
 * checks that signature here, against the Sigstore trust root embedded in this
 * package, so the file can come from any source: the cloud's mirror
 * (`GET https://cloud.calimero.network/api/tee/node-releases/{version}`), a
 * mirror of your own, or a file bundled with the app. None of them is
 * trusted; a file whose signature does not verify is refused.
 *
 * What is trusted:
 *
 * - the signer: the node release workflow of `calimero-network/mero-tee` on
 *   `master` ({@link NODE_RELEASE_SIGNER}), the identity core pins as
 *   `NODE_RELEASE_IDENTITY`;
 * - the Sigstore public-good trust root: Fulcio's CAs and Rekor's key;
 * - the minimum release you pass, below which no release is accepted.
 *
 * What is not: the transport, the server that serves the release, and the
 * relay's choice of release. A relay can present any genuinely signed release
 * at or above the minimum, and no other; its quote must then match that
 * release's measurements exactly, so it cannot claim one release and run
 * another.
 */
import { type SignerIdentity } from './sigstore.js';
import { type DcapVerify, type PublishedMrtds, type QuoteVerifier, type QuoteVerifierOptions, type TrustedProfileOptions } from './verify.js';
/** The workflow that signs every mero-tee node release, and the issuer of its identity. */
export declare const NODE_RELEASE_SIGNER: Readonly<SignerIdentity>;
/**
 * The public mirror of signed node releases, used when no other source is
 * given. Only a transport: what it serves is verified, so it can fail to
 * answer but cannot make a release trusted.
 */
export declare const DEFAULT_RELEASE_MIRROR = "https://cloud.calimero.network";
/**
 * A node release as the servers hand it out, wrapped as `{"data": ...}`: the
 * release's `published-mrtds.json`, byte for byte, and its cosign bundle.
 * Unverified until {@link verifySignedNodeRelease} says otherwise.
 */
export interface SignedNodeRelease {
    /** The release, e.g. `2.3.87`. It must be the signed file's `tag`. */
    version: string;
    /** `published-mrtds.json`, exactly as signed. */
    publishedMrtds: string;
    /** `published-mrtds.json.bundle.json`, as JSON text. */
    bundle: string;
}
export interface VerifySignedNodeReleaseOptions {
    /** Require the file's `tag` to be this release. */
    expectedVersion?: string;
    /** The certificate identity required. Defaults to {@link NODE_RELEASE_SIGNER}'s. */
    identity?: string;
    /** The OIDC issuer required. Defaults to {@link NODE_RELEASE_SIGNER}'s. */
    issuer?: string;
    /** The release's detached `published-mrtds.json.sig`, when you have it; it must be the bundle's. */
    signature?: string;
}
/**
 * Verify a node release's `published-mrtds.json` against its cosign bundle,
 * as `cosign verify-blob` would, and return the file parsed. Rejects, with the
 * reason, unless:
 *
 * - the signature over the exact bytes verifies with the bundle's certificate;
 * - that certificate chains to a Fulcio CA in the Sigstore trust root, and it
 *   and the CA were valid when Rekor logged the signature;
 * - it names the node release workflow and GitHub Actions as its issuer;
 * - Rekor's signed entry timestamp verifies, for an entry that is this
 *   signature over this file by this certificate;
 * - the file is a node release (`role: "node"`), and `expectedVersion`, when
 *   given, is its `tag`.
 *
 * Nothing is read from the clock: the certificate is checked at the time Rekor
 * logged the signature, so a release that verifies once always does.
 */
export declare function verifySignedNodeRelease(publishedMrtds: string | Uint8Array, bundle: string | object, options?: VerifySignedNodeReleaseOptions): Promise<PublishedMrtds>;
/**
 * Fetch a {@link SignedNodeRelease} from a server that wraps it as
 * `{"data": ...}`, such as the cloud's {@link cloudNodeReleaseUrl}. It is
 * only fetched: pass it to
 * {@link trustSignedRelease}, or {@link verifySignedNodeRelease}, before using it.
 */
export declare function fetchNodeRelease(url: string, options?: {
    fetch?: typeof fetch;
}): Promise<SignedNodeRelease>;
/**
 * The release a mero-tee node image was built from, read from its name, e.g.
 * `merotee-ubuntu-questing-25-10-locked-read-only-2-3-87` is `2.3.87`. Throws
 * for any other name, including the suffixed images of unreleased builds.
 */
export declare function nodeReleaseVersionFromImage(osImage: string): string;
/**
 * The release the TEE node at `baseUrl` says it runs, from the image name its
 * `GET /admin-api/tee/info` reports. The node's own claim, and not trusted:
 * it only picks which signed release to fetch, and the quote must then match
 * that release's measurements.
 *
 * `/tee/info` is read in the clear, before any session exists. A node that
 * requires sealing serves it unsealed from core#4196 on; an older one refuses
 * it with `403 sealed_required`, and then this throws saying so.
 */
export declare function fetchNodeReleaseVersion(baseUrl: string, options?: {
    fetch?: typeof fetch;
}): Promise<string>;
/** Where the cloud at `cloudUrl` (e.g. `https://cloud.calimero.network`) mirrors node release `version`. */
export declare function cloudNodeReleaseUrl(cloudUrl: string, version: string): string;
export interface TrustSignedReleaseOptions extends TrustedProfileOptions {
    /** The release, from any source; it is verified here. */
    release: SignedNodeRelease;
    /**
     * The oldest release accepted, e.g. `2.3.87`. Required: every release ever
     * signed stays validly signed, so without a floor a relay could present an
     * old release, with a flaw since fixed, and a quote from that old image
     * would pass. Raise it when a release must no longer be trusted.
     */
    minReleaseVersion: string;
    /** Override the signer; defaults to {@link NODE_RELEASE_SIGNER}. */
    identity?: string;
    issuer?: string;
}
/**
 * The {@link QuoteVerifierOptions} that trust one profile of a signed node
 * release, from an untrusted source: its signature is verified, its signed
 * `tag` must be `release.version` and no older than `minReleaseVersion`, and
 * then it is read as {@link trustedMeasurementsFromReleases} reads a bundled
 * file.
 *
 * ```ts
 * const version = await fetchNodeReleaseVersion(relayUrl);
 * const release = await fetchNodeRelease(cloudNodeReleaseUrl(DEFAULT_RELEASE_MIRROR, version));
 * const verifier = createQuoteVerifier({
 *   dcapVerify,
 *   ...(await trustSignedRelease({ release, profile: 'locked-read-only', minReleaseVersion: '2.3.87' })),
 * });
 * ```
 */
export declare function trustSignedRelease(options: TrustSignedReleaseOptions): Promise<Required<Pick<QuoteVerifierOptions, 'allowedMeasurements' | 'allowedTcbStatuses'>>>;
export interface SignedReleaseVerifierOptions extends Omit<TrustSignedReleaseOptions, 'release'> {
    /** DCAP verification: `verify` from `@phala/dcap-qvl`. */
    dcapVerify: DcapVerify;
    /**
     * Where to get the node's release, asked again each time the node is
     * attested (a restarted node may run a newer one). Untrusted: it is
     * verified, and the quote must match it.
     */
    release: () => Promise<SignedNodeRelease>;
    /** As {@link QuoteVerifierOptions.fetchCollateral}. */
    fetchCollateral?: QuoteVerifierOptions['fetchCollateral'];
    /** The current time in milliseconds, for the quote's collateral; defaults to `Date.now`. For tests. */
    now?: () => number;
}
/**
 * A {@link createQuoteVerifier} whose trusted image is the signed release the
 * node says it runs. On each attestation it gets the release, checks it with
 * {@link trustSignedRelease}, and verifies the quote against that release's
 * measurements only.
 *
 * The node's choice of release is the one thing taken from it, and it is
 * bounded: only a genuinely signed release at or above `minReleaseVersion`
 * passes, and the quote must then be of exactly that release's image. Use it
 * as `connectCloud`'s `seal`, or with `createAttestedSealedFetch`;
 * {@link createSignedReleaseSealedFetch} does the latter for you.
 */
export declare function createSignedReleaseVerifier(options: SignedReleaseVerifierOptions): QuoteVerifier;
export interface SignedReleaseSealedFetchOptions extends Omit<SignedReleaseVerifierOptions, 'release'> {
    /** The TEE node's (the relay's) base URL. */
    baseUrl: string;
    /**
     * Where to get the release the node says it runs, the version read from its
     * `GET /admin-api/tee/info` each time it is attested. A string is the base
     * URL of a mirror serving {@link cloudNodeReleaseUrl}'s path, defaulting to
     * {@link DEFAULT_RELEASE_MIRROR}; a function gets the version and returns
     * the release, e.g. from a file bundled with the app. Whichever it is, it is
     * not trusted: the release is verified. `/tee/info` is read in the clear;
     * for a node that refuses that, see `releaseVersion`.
     */
    releaseSource?: string | ((context: {
        baseUrl: string;
        version: string;
        fetch: typeof fetch;
    }) => Promise<SignedNodeRelease>);
    /**
     * The release to fetch when the node will not name one: a node that
     * requires sealing (`[server.sealed] required`) and predates core#4196
     * refuses `/tee/info` unsealed. Used only then; a node that answers is
     * taken at its word. Either way untrusted: the quote must match the signed
     * release, so a wrong version only fails the attestation.
     */
    releaseVersion?: string;
    /** Also require the node to run this application with this bytecode hash. */
    applicationId?: string;
    applicationHash?: string;
    /** Fetch for the release, the attestation and the envelopes. Defaults to global `fetch`. */
    fetch?: typeof fetch;
}
/**
 * {@link createAttestedSealedFetch} for a TEE node known only by URL, trusting
 * whatever signed release at or above `minReleaseVersion` it runs: it reads
 * the release the node names from its `/tee/info` (or takes `releaseVersion`
 * when a node too old to serve that unsealed requires sealing), gets that release from
 * `releaseSource` (the public mirror unless you say otherwise), verifies its
 * signature, builds the quote verifier from its measurements, attests the node
 * and seals everything to it.
 *
 * ```ts
 * import { verify as dcapVerify } from '@phala/dcap-qvl';
 *
 * const relay = new RelayClient({
 *   relayUrl,
 *   fetch: createSignedReleaseSealedFetch({
 *     baseUrl: relayUrl,
 *     dcapVerify,
 *     profile: 'locked-read-only',
 *     minReleaseVersion: '2.3.87',
 *   }),
 *   ...
 * });
 * ```
 */
export declare function createSignedReleaseSealedFetch(options: SignedReleaseSealedFetchOptions): typeof fetch;
