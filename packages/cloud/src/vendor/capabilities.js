// Vendored from @calimero-network/mero-js 26.9.1 (MIT): pure helpers apps already
// rely on, unchanged except for import paths. The transport they once sat on is
// gone; see ../backend.ts for the release-v2 implementation.

// Member capability bitmask constants — mirrors core's `MemberCapabilities`
// (crates/context/config/src/lib.rs). The value stored per-member is a u32
// bitmask. Core currently assigns bits 0..=9; bits 10 and above are unassigned
// and may be claimed by future core versions, so an application MUST NOT
// assume any particular bit is safe for its own use unless core documents it
// as reserved for applications.
/**
 * Capability bits as defined by core's `MemberCapabilities`.
 *
 * The per-member value is a u32 bitmask. Core currently assigns bits 0..=9
 * (the entries below); bits 10 and above are unassigned — do not repurpose
 * them for application data, as a future core release may claim them.
 */
export const CAPABILITIES = {
    CAN_CREATE_CONTEXT: 1 << 0,
    CAN_INVITE_MEMBERS: 1 << 1,
    CAN_JOIN_OPEN_SUBGROUPS: 1 << 2,
    MANAGE_MEMBERS: 1 << 3,
    MANAGE_APPLICATION: 1 << 4,
    CAN_CREATE_SUBGROUP: 1 << 5,
    CAN_DELETE_SUBGROUP: 1 << 6,
    CAN_MANAGE_VISIBILITY: 1 << 7,
    CAN_MANAGE_METADATA: 1 << 8,
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
    CAN_AUTHOR_ON_BEHALF: 1 << 9,
};
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
export const CAPABILITY_PRESETS = {
    /** No capabilities. */
    NONE: 0,
    /** Join Open subgroups only: what a namespace starts with. */
    JOIN_ONLY: CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS,
    /**
     * Create contexts, invite members, join Open subgroups (= 7). A member who
     * can work in the namespace but not reshape it.
     */
    CONTRIBUTOR: CAPABILITIES.CAN_CREATE_CONTEXT |
        CAPABILITIES.CAN_INVITE_MEMBERS |
        CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS,
    /**
     * `CONTRIBUTOR` plus create and delete subgroups and manage their visibility
     * (= 231). What mero-chat gives members, so they can start and close their
     * own channels.
     */
    COLLABORATOR: CAPABILITIES.CAN_CREATE_CONTEXT |
        CAPABILITIES.CAN_INVITE_MEMBERS |
        CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS |
        CAPABILITIES.CAN_CREATE_SUBGROUP |
        CAPABILITIES.CAN_DELETE_SUBGROUP |
        CAPABILITIES.CAN_MANAGE_VISIBILITY,
};
/**
 * Builds a u32 mask from capability names and/or bit values:
 * `capMask('CAN_CREATE_CONTEXT', 'CAN_INVITE_MEMBERS') === 3`.
 * Throws on a name core does not assign, so a typo can't silently yield 0.
 */
export function capMask(...caps) {
    let mask = 0;
    for (const cap of caps) {
        if (typeof cap === 'number') {
            mask |= cap;
        }
        else if (Object.prototype.hasOwnProperty.call(CAPABILITIES, cap)) {
            mask |= CAPABILITIES[cap];
        }
        else {
            throw new Error(`unknown capability: ${String(cap)}`);
        }
    }
    return mask >>> 0;
}
/**
 * The names of the assigned capability bits set in `mask`, in bit order.
 * Unassigned bits (10 and above) are not reported.
 */
export function capNames(mask) {
    return Object.keys(CAPABILITIES).filter((name) => hasCap(mask, CAPABILITIES[name]));
}
/**
 * Returns true if `mask` has every bit of `cap` set. Both operands are
 * coerced to unsigned 32-bit (`>>> 0`) before comparing so a high bit such
 * as `1 << 31` doesn't fall foul of `&` yielding a signed result.
 */
export function hasCap(mask, cap) {
    const capU32 = cap >>> 0;
    return ((mask & capU32) >>> 0) === capU32;
}
/** Returns `mask` with every bit of `cap` set (u32-normalized). */
export function withCap(mask, cap) {
    return (mask | cap) >>> 0;
}
/** Returns `mask` with every bit of `cap` cleared (u32-normalized). */
export function withoutCap(mask, cap) {
    return (mask & ~cap) >>> 0;
}
