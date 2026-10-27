import { type Signer } from '../signer/signer.js';
/** What a root scopes one device to. */
export interface DeviceScopeInput {
    /**
     * The account root's signing secret, 64 hex. Pass this or {@link signer}.
     */
    rootSecret?: string;
    /**
     * The account root as a {@link Signer} — for a root that cannot be exported.
     * Its `publicKey` is the genesis key the proof carries, and the account is
     * derived from it.
     */
    signer?: Signer;
    /** The device being scoped, 64 hex — the one its certificate names. */
    device: string;
    /**
     * Application ids the device may speak for, 64 hex each. **Empty means all of
     * them**, which is also what the default is.
     *
     * A namespace binds the device only when its application is listed here (or
     * the list is empty), so a scope naming the wrong application yields a relay
     * refusal of `400`, not a binding.
     */
    applications?: readonly string[];
    /**
     * Orders scopes for this device: only a higher one supersedes. 0 for a
     * device's first scope.
     */
    scopeEpoch?: number;
}
/**
 * The 32 bytes a root signs to scope a device: `domain_hash` over account,
 * device, `scope_epoch` (u32 LE), `key_epoch` (u32 LE), then each application id
 * as its own length-prefixed part.
 */
export declare function deviceScopePayload(input: {
    account: string;
    device: string;
    applications: readonly string[];
    scopeEpoch: number;
    keyEpoch: number;
}): Promise<Uint8Array>;
/**
 * Scope a device, returning the hex `AccountProof<DeviceScope>` a relay's
 * `linkAccountDevice` takes beside the credential.
 *
 * ```
 * AccountProof { genesis: AccountGenesis, chain: Vec<RootKeyHandoff>, statement: DeviceScope }
 *   AccountGenesis { version: u8, root_sign_pk: [u8; 32] }
 *   chain          → u32-LE count (0 here)
 *   DeviceScope    { account, device: [u8; 32] x2, applications: Vec<[u8; 32]>,
 *                    scope_epoch: u32, key_epoch: u32, signature: [u8; 64] }
 * ```
 *
 * `chain` is empty and `key_epoch` 0 for the reason they are in
 * {@link signDeviceCert}: a root that was never handed off signs directly.
 */
export declare function signDeviceScope(input: DeviceScopeInput): Promise<string>;
