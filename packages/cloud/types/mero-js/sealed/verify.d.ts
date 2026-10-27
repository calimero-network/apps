/**
 * Verifying a TEE node's quote in the page, before trusting the key it binds.
 *
 * A quote proves what runs in a TD only once it has been checked: its
 * signatures against Intel's root, the TCB status of the platform, the
 * measurements of the image, and that its report data is the nonce and the
 * binding this client asked for. {@link createQuoteVerifier} does all of that
 * here, with nothing but the node: the node hands over the Intel-signed
 * collateral with its quote (`includeCollateral`), and a node cannot forge
 * collateral, only choose which valid collateral to serve.
 *
 * The DCAP verification itself — parsing the quote, checking its signature
 * chain and appraising its TCB level against the collateral — comes from a
 * library you pass in, normally `verify` from `@phala/dcap-qvl`, a pure
 * JavaScript implementation that runs in browsers, Node and React Native. It
 * is passed in rather than bundled so this SDK keeps no runtime dependencies,
 * and applications that never talk to a TEE node pay nothing for it.
 */
import type { VerifyTransportQuote } from './sealed.js';
/**
 * The collateral a quote is verified against — TCB info, QE identity, CRLs and
 * their chains — in dcap-qvl's form: byte fields are hex strings or byte
 * arrays. What `/admin-api/tee/attest` returns with `includeCollateral`, and
 * what `@phala/dcap-qvl`'s `getCollateral` fetches.
 */
export interface DcapCollateral {
    pck_crl_issuer_chain: string;
    root_ca_crl: number[] | string;
    pck_crl: number[] | string;
    tcb_info_issuer_chain: string;
    tcb_info: string;
    tcb_info_signature: number[] | string;
    qe_identity_issuer_chain: string;
    qe_identity: string;
    qe_identity_signature: number[] | string;
}
/** What a DCAP verifier returns for a quote whose signature chain verified. */
export interface DcapVerifiedReport {
    status: string;
    advisory_ids?: string[];
    report: {
        type: string;
        data: unknown;
    };
}
/**
 * Verify a quote's signature chain against `collateral` as of `nowSecs`, and
 * appraise its TCB level. Throws when it does not verify. `verify` from
 * `@phala/dcap-qvl` has exactly this shape.
 */
export type DcapVerify = (quote: Uint8Array, collateral: DcapCollateral, nowSecs: number) => DcapVerifiedReport;
/**
 * One image's measurements, all five registers, hex. A quote matches it only
 * when every register does, so measurements of different images never combine.
 */
export interface TrustedMeasurements {
    mrtd: string;
    rtmr0: string;
    rtmr1: string;
    rtmr2: string;
    rtmr3: string;
}
export interface QuoteVerifierOptions {
    /** DCAP verification: `verify` from `@phala/dcap-qvl`. */
    dcapVerify: DcapVerify;
    /**
     * The images trusted, each by all of its measurements. The way to say which
     * code may read the traffic: build it with {@link trustedMeasurementsFromReleases}
     * from the `published-mrtds.json` of the releases you trust.
     */
    allowedMeasurements?: TrustedMeasurements[];
    /**
     * MRTDs (hex) accepted. On its own this does not name an image: on GCP the
     * MRTD measures the platform's TD firmware, which every image shares, and
     * the image is in RTMR1–3. So a verifier needs either
     * {@link allowedMeasurements}, or this with all of `allowedRtmr1`–`3`.
     */
    allowedMrtd?: string[];
    /** RTMR allowlists (hex); a register is not checked when its list is left out. */
    allowedRtmr0?: string[];
    allowedRtmr1?: string[];
    allowedRtmr2?: string[];
    allowedRtmr3?: string[];
    /**
     * TCB statuses accepted. Defaults to `['UpToDate']`. `Revoked` is refused
     * even when listed.
     */
    allowedTcbStatuses?: string[];
    /**
     * Where to get collateral when the node sends none (it predates
     * `includeCollateral`): for example
     * `(quote) => getCollateral(PHALA_PCCS_URL, quote)` from `@phala/dcap-qvl`.
     * Without it, such a node's quote is refused.
     */
    fetchCollateral?: (quote: Uint8Array) => Promise<DcapCollateral>;
    /** The current time in milliseconds; defaults to `Date.now`. For tests. */
    now?: () => number;
}
/** A verifier for {@link fetchAttestedTransportKey}, which asks the node for collateral. */
export type QuoteVerifier = VerifyTransportQuote & {
    readonly includeCollateral: true;
};
/**
 * A verifier that checks a TEE node's quote here, in the page, and accepts it
 * only when every check passes:
 *
 * - its signatures verify against Intel's root, with collateral that is valid
 *   now;
 * - the platform's TCB status is one allowed (`UpToDate` by default), and
 *   never `Revoked`;
 * - its measurements are those of a trusted image: one of
 *   `allowedMeasurements` in full, and the MRTD and any RTMRs listed;
 * - its report data is the nonce followed by the binding the client computed.
 *
 * Any failure rejects with the reason; nothing is trusted from a quote that
 * does not pass. Mock quotes never pass: they carry no signature.
 *
 * ```ts
 * import { verify as dcapVerify } from '@phala/dcap-qvl';
 *
 * const verifier = createQuoteVerifier({
 *   dcapVerify,
 *   ...trustedMeasurementsFromReleases([publishedMrtds], { profile: 'locked-read-only' }),
 * });
 * const fetch = createSealedFetch({
 *   baseUrl,
 *   transportPublicKey: () => fetchAttestedTransportKey(admin, verifier),
 * });
 * ```
 */
export declare function createQuoteVerifier(options: QuoteVerifierOptions): QuoteVerifier;
/**
 * A mero-tee node release's `published-mrtds.json`: the measurements the
 * release workflow observed booting each profile of its image on TDX, signed
 * with the release. Only the fields read here are typed.
 */
export interface PublishedMrtds {
    role?: string;
    tag?: string;
    profiles: Record<string, {
        mrtd: string;
        rtmr0: string;
        rtmr1: string;
        rtmr2: string;
        rtmr3: string;
        allowed_tcb_statuses?: string[];
    }>;
}
/**
 * The {@link QuoteVerifierOptions} that trust exactly one profile of the given
 * releases: each release's image by all of its measurements, and only the TCB
 * statuses every one of those releases accepts.
 *
 * Pass every release a node you talk to may run. During a rollout that is the
 * old one and the new one; drop the old one once no node runs it.
 *
 * ```ts
 * import published from './trusted/mero-tee-v2.3.78.published-mrtds.json';
 *
 * const verifier = createQuoteVerifier({
 *   dcapVerify,
 *   ...trustedMeasurementsFromReleases([published], { profile: 'locked-read-only' }),
 * });
 * ```
 *
 * Where the file comes from is the trust decision. Shipping it with the app
 * (checked out of a release you verified) trusts that release; fetching it at
 * run time trusts whoever serves it.
 */
/**
 * The one image profile a release publishes for production. The `debug` and
 * `debug-read-only` images are signed and published beside it, but run with
 * SSH and the operator's tooling inside the TD, so trusting one trusts an
 * image the operator can read.
 */
export declare const PRODUCTION_PROFILE = "locked-read-only";
export interface TrustedProfileOptions {
    /** The image profile to trust, e.g. `locked-read-only`. */
    profile: string;
    /**
     * Trust a profile other than {@link PRODUCTION_PROFILE}, such as `debug`.
     * Its image is readable by whoever operates the node, so only for testing.
     */
    allowDebugProfile?: boolean;
}
export declare function trustedMeasurementsFromReleases(releases: PublishedMrtds[], { profile, allowDebugProfile }: TrustedProfileOptions): Required<Pick<QuoteVerifierOptions, 'allowedMeasurements' | 'allowedTcbStatuses'>>;
