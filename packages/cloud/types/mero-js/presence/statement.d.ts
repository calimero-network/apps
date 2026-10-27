/** core's `PRESENCE_DOMAIN`: part of the signed bytes. */
export declare const PRESENCE_DOMAIN: Uint8Array;
/** `sha256(borsh(Option<Vec<u8>>))`: `None` is `[0]`, `Some(v)` is `[1] ‖ u32le(len) ‖ v`. */
export declare function stateHash(state: Uint8Array | null): Promise<Uint8Array>;
/** What the device key signs, raw: domain ‖ context ‖ author ‖ seq ‖ sentAtMs ‖ stateHash. */
export declare function presenceStatementBytes(input: {
    contextId: string;
    author: string;
    seq: bigint;
    sentAtMs: bigint;
    state: Uint8Array | null;
}): Promise<Uint8Array>;
