/**
 * Just enough DER and X.509 to check a Sigstore signing certificate with
 * WebCrypto: read a certificate's signed part, validity, key and extensions,
 * and verify the ECDSA signatures (P-256 and P-384) Sigstore uses.
 *
 * Written here, rather than taken from a library, so the SDK keeps no runtime
 * dependencies and runs wherever WebCrypto does. It parses strictly and throws
 * on anything it does not expect; it is not a general X.509 implementation.
 */
export type Curve = 'P-256' | 'P-384';
export type Hash = 'SHA-256' | 'SHA-384';
/** One DER element: its tag, and where it and its contents lie in `bytes`. */
export interface Element {
    tag: number;
    bytes: Uint8Array;
    /** Offset of the element's first (tag) byte. */
    offset: number;
    /** Offset of its contents. */
    start: number;
    /** Offset just past it. */
    end: number;
}
/** Parse one complete DER element, refusing trailing bytes. */
export declare function parseDer(bytes: Uint8Array): Element;
export declare function children(element: Element): Element[];
/** `element` if it has `tag`; otherwise throws naming `what`. */
export declare function expectTag(element: Element | undefined, tag: number, what: string): Element;
export declare function contents(element: Element): Uint8Array;
export interface Certificate {
    der: Uint8Array;
    /** The signed part, exactly as the issuer signed it. */
    tbs: Uint8Array;
    /** The hash of the ECDSA signature the issuer made over `tbs`. */
    signatureHash: Hash;
    /** That signature, DER. */
    signature: Uint8Array;
    /** The issuer and subject names, DER, to compare byte for byte. */
    issuer: Uint8Array;
    subject: Uint8Array;
    /** Validity, in milliseconds since the epoch, both ends inclusive. */
    notBefore: number;
    notAfter: number;
    /** The subject's key, DER SubjectPublicKeyInfo, and its curve. */
    spki: Uint8Array;
    curve: Curve;
    /** Each extension's value (the contents of its OCTET STRING), by object identifier. */
    extensions: Map<string, Uint8Array>;
}
/**
 * Parse a DER X.509 certificate with an ECDSA key, signed with ECDSA. Throws
 * naming what is wrong.
 */
export declare function parseCertificate(der: Uint8Array): Certificate;
/** The object identifiers in a DER `SEQUENCE OF OBJECT IDENTIFIER` (an extended key usage). */
export declare function objectIdentifiers(der: Uint8Array): string[];
/**
 * An ECDSA signature as WebCrypto takes it (IEEE P1363: `r || s`, each the
 * curve's size), from the DER `SEQUENCE { r INTEGER, s INTEGER }` X.509 and
 * cosign use.
 */
export declare function ecdsaSignatureToP1363(der: Uint8Array, curve: Curve): Uint8Array;
/** Verify a DER ECDSA `signature` over `data` with a DER SubjectPublicKeyInfo key. */
export declare function verifyEcdsa(spki: Uint8Array, curve: Curve, hash: Hash, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
/** Decode base64 (standard alphabet), refusing anything else. */
export declare function fromBase64(value: string, what: string): Uint8Array;
/** The DER of the one `CERTIFICATE` block a PEM holds. */
export declare function pemCertificate(pem: string, what: string): Uint8Array;
