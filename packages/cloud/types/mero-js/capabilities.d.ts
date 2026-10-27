/**
 * Capability bits as defined by core's `MemberCapabilities`.
 *
 * The per-member value is a u32 bitmask. Core currently assigns bits 0..=9
 * (the entries below); bits 10 and above are unassigned — do not repurpose
 * them for application data, as a future core release may claim them.
 */
export declare const CAPABILITIES: {
    readonly CAN_CREATE_CONTEXT: number;
    readonly CAN_INVITE_MEMBERS: number;
    readonly CAN_JOIN_OPEN_SUBGROUPS: number;
    readonly MANAGE_MEMBERS: number;
    readonly MANAGE_APPLICATION: number;
    readonly CAN_CREATE_SUBGROUP: number;
    readonly CAN_DELETE_SUBGROUP: number;
    readonly CAN_MANAGE_VISIBILITY: number;
    readonly CAN_MANAGE_METADATA: number;
    /**
     * Publish writes attributed to ANOTHER member, under a warrant that member
     * signed — the grant delegated execution runs on.
     *
     * Implied by nothing: not by membership, not by admin, and not propagated by
     * the subgroup-admit cascade. So every group is authorship-closed until an
     * admin sets this bit, and a relay without it is refused at
     * `performIntent` before anything executes. That is why it is worth naming
     * here rather than leaving callers to write `1 << 9`: a client granting it
     * has to be able to say what it is granting.
     */
    readonly CAN_AUTHOR_ON_BEHALF: number;
};
export type CapabilityName = keyof typeof CAPABILITIES;
export type CapabilityBit = (typeof CAPABILITIES)[CapabilityName];
/**
 * Ready-made masks for `setDefaultCapabilities` / `setMemberCapabilities` and
 * `RelayClient.foundNamespace({ defaultCapabilities })`, so an app can name the
 * default it gives members instead of passing a bare number.
 *
 * Why this matters: a namespace's default mask is copied into a non-admin
 * member's row when they join, and a namespace starts without
 * `CAN_CREATE_CONTEXT` in it. An app that never sets a default leaves every
 * invited member unable to create a context until an admin grants it by hand.
 *
 * None of these include `CAN_AUTHOR_ON_BEHALF`; grant that deliberately (see
 * `AdminApiClient.grantAuthorship` / `openToDelegatedExecution`).
 */
export declare const CAPABILITY_PRESETS: {
    /** No capabilities. */
    readonly NONE: 0;
    /** Join Open subgroups only: what a namespace starts with. */
    readonly JOIN_ONLY: number;
    /**
     * Create contexts, invite members, join Open subgroups (= 7). A member who
     * can work in the namespace but not reshape it.
     */
    readonly CONTRIBUTOR: number;
    /**
     * `CONTRIBUTOR` plus create and delete subgroups and manage their visibility
     * (= 231). What mero-chat gives members, so they can start and close their
     * own channels.
     */
    readonly COLLABORATOR: number;
};
export type CapabilityPreset = keyof typeof CAPABILITY_PRESETS;
/**
 * Builds a u32 mask from capability names and/or bit values:
 * `capMask('CAN_CREATE_CONTEXT', 'CAN_INVITE_MEMBERS') === 3`.
 * Throws on a name core does not assign, so a typo can't silently yield 0.
 */
export declare function capMask(...caps: Array<CapabilityName | number>): number;
/**
 * The names of the assigned capability bits set in `mask`, in bit order.
 * Unassigned bits (10 and above) are not reported.
 */
export declare function capNames(mask: number): CapabilityName[];
/**
 * Returns true if `mask` has every bit of `cap` set. Both operands are
 * coerced to unsigned 32-bit (`>>> 0`) before comparing so a high bit such
 * as `1 << 31` doesn't fall foul of `&` yielding a signed result.
 */
export declare function hasCap(mask: number, cap: number): boolean;
/** Returns `mask` with every bit of `cap` set (u32-normalized). */
export declare function withCap(mask: number, cap: number): number;
/** Returns `mask` with every bit of `cap` cleared (u32-normalized). */
export declare function withoutCap(mask: number, cap: number): number;
