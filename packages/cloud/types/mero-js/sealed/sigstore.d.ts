/**
 * Verifying a cosign keyless signature, as `cosign verify-blob --bundle` does,
 * with WebCrypto and the Sigstore trust root embedded in this package.
 *
 * mero-tee signs each release asset with cosign keyless: there is no release
 * key, only a Fulcio certificate that lives ten minutes, issued to one GitHub
 * Actions workflow run, and a Rekor log entry that proves the signature was
 * made while the certificate was valid. So the checks are: the signature over
 * the bytes verifies with the certificate's key; Rekor's signed entry
 * timestamp verifies, and the entry it signs is this signature over these
 * bytes by this certificate; the certificate chains to a Fulcio CA and was
 * valid when Rekor logged it; and the certificate names the workflow expected.
 * The same checks core runs in `crates/tee-release/src/sigstore_verify.rs`.
 *
 * Nothing here reads the clock. Every time is Rekor's `integratedTime`, which
 * its signature covers, so a verification that passes once passes forever,
 * whatever the client's clock says.
 */
import { type Certificate } from './x509.js';
/** Who must have signed: the certificate's SAN URI and its OIDC issuer, each matched exactly. */
export interface SignerIdentity {
    identity: string;
    issuer: string;
}
/**
 * Verify a cosign keyless `bundle` over `body`, signed by `signer`. Resolves
 * with the time Rekor logged it (seconds); rejects with the reason otherwise.
 * `signature`, when given, is the detached `.sig` published beside the file,
 * and must be the bundle's.
 */
export declare function verifyCosignBundle(body: Uint8Array, bundle: unknown, signer: SignerIdentity, signature?: string): Promise<{
    integratedTime: number;
}>;
/**
 * Check that `leaf` was issued by a Fulcio CA in the trust root, and that it,
 * the CA's certificates and the CA itself (by the trust root's `validFor`)
 * were all valid at `at` (milliseconds): when Rekor logged the signature, not
 * now, since a Fulcio certificate lives ten minutes. Every signature on the
 * way is checked, with the algorithm its certificate names.
 */
export declare function chainsToFulcio(leaf: Certificate, at: number): Promise<void>;
