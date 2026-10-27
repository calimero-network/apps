/**
 * Which agent images to trust: a mero-kms release's signed agent allowlist,
 * `kms-agent-attestation-policy.<profile>.json`, and a quote verifier built
 * from it.
 *
 * The KMS release workflow measures the release's agent image and signs its
 * allowlist with cosign keyless, beside the rest of the release. The allowlist
 * can therefore come from anywhere (a release asset, mdma's mirror, a file in
 * the app): {@link verifySignedAgentPolicy} checks the signature here, against
 * the Sigstore trust root embedded in this package, and refuses anything else.
 */
import { type SignerIdentity } from '../sealed/sigstore.js';
import { type DcapCollateral, type DcapVerify, type QuoteVerifier } from '../sealed/verify.js';
/** The workflow that signs every mero-kms release, agent allowlists included. */
export declare const KMS_RELEASE_SIGNER: Readonly<SignerIdentity>;
/** An agent allowlist, as the KMS release publishes it. Every list must be non-empty. */
export interface AgentPolicy {
    schema_version?: number;
    role?: string;
    profile?: string;
    /** The mero-kms release it belongs to. */
    version?: string;
    allowed_tcb_statuses: string[];
    allowed_mrtd: string[];
    allowed_rtmr0: string[];
    allowed_rtmr1: string[];
    allowed_rtmr2: string[];
    allowed_rtmr3: string[];
}
export interface VerifySignedAgentPolicyOptions {
    /** Require this profile; defaults to `locked-read-only`, the only one whose host cannot reach in. */
    profile?: string;
    /** Require the file's `version` to be this mero-kms release. */
    expectedVersion?: string;
    /** The certificate identity required. Defaults to {@link KMS_RELEASE_SIGNER}'s. */
    identity?: string;
    /** The OIDC issuer required. Defaults to {@link KMS_RELEASE_SIGNER}'s. */
    issuer?: string;
    /**
     * The image role the allowlist must be for: `agent` (the default), or
     * `inference`, the release's `kms-inference-attestation-policy.<profile>.json`
     * for its private inference image. Both have the same shape and signer.
     */
    role?: 'agent' | 'inference';
}
/**
 * Verify an agent allowlist against its cosign bundle, as `cosign verify-blob`
 * would, and return it parsed. Rejects unless it was signed by the KMS release
 * workflow, it is an allowlist for `options.role` (default `agent`) and the profile asked
 * for, every list in it is non-empty, and `expectedVersion`, when given, is its
 * `version`.
 */
export declare function verifySignedAgentPolicy(policy: string | Uint8Array, bundle: string | object, options?: VerifySignedAgentPolicyOptions): Promise<AgentPolicy>;
export interface AgentQuoteVerifierOptions {
    /** `verify` from `@phala/dcap-qvl`, or anything that verifies a quote the same way. */
    dcapVerify: DcapVerify;
    /**
     * The gate sends no collateral: fetch it, e.g.
     * `(quote) => getCollateral(PHALA_PCCS_URL, quote)` from `@phala/dcap-qvl`.
     */
    fetchCollateral: (quote: Uint8Array) => Promise<DcapCollateral>;
    /** The current time in milliseconds; defaults to `Date.now`. For tests. */
    now?: () => number;
}
/**
 * A verifier for {@link attestAgent} that accepts a quote only from an agent
 * image in `policy`: its signature and collateral verify, its TCB status is
 * one the policy allows (never `Revoked`), it is not a debug TD, and each of
 * MRTD and RTMR0-3 is in the policy's list. Mock quotes never pass.
 */
export declare function agentQuoteVerifier(policy: AgentPolicy, options: AgentQuoteVerifierOptions): QuoteVerifier;
