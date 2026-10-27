/**
 * Learn a relay's node signing key from its TEE attestation.
 *
 * `login()` binds a session to the node key the client names, and that key must
 * never be taken from the node being logged in to on its word — the answering
 * party would choose what the device signs about. A TEE quote is different: the
 * node cannot put a key into it that the TEE did not bind. With `bindNodeKey`,
 * core commits the node's signing key into the quote's report data:
 *
 *   report_data = nonce (32)  ‖  SHA-256("calimero.tee-attest.key-binding.v1" ‖ 0^32 ‖ key)
 *
 * (the 32 zero bytes stand for "no application", core's `attest_key_binding`).
 * So the client sends a fresh nonce, reads the report data out of the RAW quote
 * bytes — never the server's parsed rendering of them — and accepts the returned
 * key only if both halves match.
 *
 * That proves the key came from whatever produced the quote. Whether that is a
 * genuine TDX guest running a trusted image is the quote's signature and
 * measurements, which this module does not judge: a real quote needs a
 * `verifyQuote` supplied by the caller, and a mock quote (a dev-only format with
 * no signature at all) is refused unless `allowMock` is set.
 */
import type { VerifyTransportQuote } from '../sealed/sealed.js';
export interface AttestedNodeKey {
    /** The relay's node signing key, hex (32 bytes), as the quote binds it. */
    readonly nodeKey: string;
    /** True when the quote was a mock — no TEE vouched for anything. */
    readonly mock: boolean;
}
export interface AttestRelayNodeKeyOptions {
    readonly relayUrl: string;
    /**
     * Accept a mock quote. DEV/TEST ONLY: a mock quote carries no signature, so it
     * proves nothing about the hardware — only that the node bound this key into
     * something it produced for our nonce.
     */
    readonly allowMock?: boolean;
    /**
     * Verify a real quote's signature chain and measurements; throw to refuse.
     * Required for a non-mock quote: without it the binding would be checked
     * against bytes nothing has authenticated.
     */
    readonly verifyQuote?: (quote: Uint8Array) => Promise<void>;
    /**
     * Verify a real quote the way a sealed transport does: a
     * {@link VerifyTransportQuote}, such as `createSignedReleaseVerifier` (the
     * relay's signed mero-tee release, Intel's chain, every register of its
     * image). Called with our nonce and the node-key binding as the expected
     * report data, and with the relay's collateral when it asks for it. Takes
     * precedence over `verifyQuote`.
     */
    readonly verify?: VerifyTransportQuote;
    readonly fetch?: typeof fetch;
}
/** Core's `attest_key_binding(None, key)`. */
export declare function attestKeyBinding(nodeKey: Uint8Array): Promise<Uint8Array>;
/** The 64 report-data bytes of a quote, read from the quote itself. */
export declare function reportDataOf(quote: Uint8Array): {
    reportData: Uint8Array;
    mock: boolean;
};
/**
 * Ask a relay for a quote binding its node key to a fresh nonce, check the
 * binding, and return the key.
 */
export declare function attestRelayNodeKey(opts: AttestRelayNodeKeyOptions): Promise<AttestedNodeKey>;
