/**
 * Builds a u32 mask from capability names and/or bit values:
 * `capMask('CAN_CREATE_CONTEXT', 'CAN_INVITE_MEMBERS') === 3`.
 * Throws on a name core does not assign, so a typo can't silently yield 0.
 */
export function capMask(...caps: any[]): number;
/**
 * The names of the assigned capability bits set in `mask`, in bit order.
 * Unassigned bits (10 and above) are not reported.
 */
export function capNames(mask: any): string[];
/**
 * Returns true if `mask` has every bit of `cap` set. Both operands are
 * coerced to unsigned 32-bit (`>>> 0`) before comparing so a high bit such
 * as `1 << 31` doesn't fall foul of `&` yielding a signed result.
 */
export function hasCap(mask: any, cap: any): boolean;
/** Returns `mask` with every bit of `cap` set (u32-normalized). */
export function withCap(mask: any, cap: any): number;
/** Returns `mask` with every bit of `cap` cleared (u32-normalized). */
export function withoutCap(mask: any, cap: any): number;
export namespace CAPABILITIES {
    let CAN_CREATE_CONTEXT: number;
    let CAN_INVITE_MEMBERS: number;
    let CAN_JOIN_OPEN_SUBGROUPS: number;
    let MANAGE_MEMBERS: number;
    let MANAGE_APPLICATION: number;
    let CAN_CREATE_SUBGROUP: number;
    let CAN_DELETE_SUBGROUP: number;
    let CAN_MANAGE_VISIBILITY: number;
    let CAN_MANAGE_METADATA: number;
    let CAN_AUTHOR_ON_BEHALF: number;
}
export namespace CAPABILITY_PRESETS {
    export let NONE: number;
    import JOIN_ONLY = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;
    export { JOIN_ONLY };
    export let CONTRIBUTOR: number;
    export let COLLABORATOR: number;
}
