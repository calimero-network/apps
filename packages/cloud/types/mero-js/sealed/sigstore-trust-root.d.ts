/**
 * The parts of the Sigstore public-good trust root that verifying a mero-tee
 * release's cosign bundle needs: the Fulcio certificate authorities that issue
 * the release workflow's short-lived signing certificates, and the Rekor log
 * key that signs the bundle's signed entry timestamp. Each with the window in
 * which the trust root says it was in use.
 *
 * Copied from the `trusted_root.json` that Sigstore publishes through its TUF
 * repository (https://tuf-repo-cdn.sigstore.dev, target `trusted_root.json`),
 * as shipped by the `sigstore` Python client 4.5.0 in
 * `sigstore/_store/https%3A%2F%2Ftuf-repo-cdn.sigstore.dev/trusted_root.json`.
 * Embedded rather than fetched: fetching it at run time would trust whoever
 * serves it, the very thing this check exists to avoid.
 *
 * Left out, because a legacy cosign bundle never uses them: the CT logs (the
 * certificate's SCT is not checked here, as core does not either), the
 * timestamp authority, and the Rekor v2 log `log2025-1.rekor.sigstore.dev`,
 * whose Ed25519 key signs checkpoints rather than signed entry timestamps. A
 * bundle that names any log but those below is refused.
 *
 * To refresh it when Sigstore rotates a key or adds a CA: take the current
 * `trusted_root.json` from a TUF client (`python -m sigstore` or `cosign
 * initialize` both keep one, verified against the TUF root), and copy each
 * `certificateAuthorities[].certChain.certificates[].rawBytes` with its
 * `validFor`, and each ECDSA `tlogs[]` entry's `publicKey.rawBytes`,
 * `publicKey.validFor` and `logId.keyId` (as hex). The tests check each log id
 * is the SHA-256 of its key and each chain verifies.
 */
/** A Fulcio CA: its chain from the certificate that issues leaves up to the root, DER as base64. */
export interface FulcioAuthority {
    uri: string;
    /** When the trust root says this CA issued certificates. No `end`: it still does. */
    validFor: {
        start: string;
        end?: string;
    };
    certChain: string[];
}
/** A Rekor log whose signed entry timestamps are accepted. */
export interface RekorLog {
    baseUrl: string;
    /** The log id a bundle names it by: the SHA-256 of its public key, hex. */
    logId: string;
    /** Its public key: DER SubjectPublicKeyInfo, base64. ECDSA P-256 with SHA-256. */
    publicKey: string;
    validFor: {
        start: string;
        end?: string;
    };
}
export declare const FULCIO_AUTHORITIES: readonly FulcioAuthority[];
export declare const REKOR_LOGS: readonly RekorLog[];
