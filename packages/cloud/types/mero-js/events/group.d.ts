import type { GroupMemberRole } from '../admin-api/admin-types.js';
/** Parsed group-membership event (core's untagged `NodeEvent` group variant). */
export interface GroupMembershipEventData {
    groupId: string;
    type: 'MemberJoined' | 'MemberAdded' | 'MemberRemoved';
    data: {
        /** The member's ACCOUNT, hex-encoded 32 bytes (64 chars) - the principal the
         * governance rows name. Not a signing key: the field this replaced
         * carried one, and both are strings, so the rename is what makes a stale
         * consumer fail loudly instead of comparing accounts against keys forever. */
        memberAccount: string;
        /** Absent on `MemberRemoved`, and on a `MemberJoined` inherited from an Open
         * subgroup. Core's set is closed. */
        role?: GroupMemberRole;
    };
}
/**
 * A migration was accepted and its target ABI state version resolved.
 * `toStateVersion` is the `#[app::state(version = N)]` number, not the bundle
 * semver (`toVersion`).
 */
export interface MigrationStartedData {
    fromVersion: string;
    toVersion: string;
    toStateVersion: number;
    /** Contexts the EMITTING NODE enumerated for the migration. Node-local, never
     * the fleet cohort size that `MigrationProgressData.total` carries. */
    localContextsTotal: number;
}
/**
 * Fleet rollup counters, recomputed as peers' heartbeat facts change. Counters
 * only: the per-member detail behind them stays in the admin-gated
 * `getMigrationStatus` read.
 */
export interface MigrationProgressData {
    migrated: number;
    inProgress: number;
    unknown: number;
    failed: number;
    /** The pinned FLEET COHORT size, never a node-local context count like
     * `MigrationStartedData.localContextsTotal`. */
    total: number;
}
/**
 * One subgroup's local context swaps advanced on the emitting node.
 *
 * Admin-only: it names a descendant subgroup, which a plain namespace member
 * may not enumerate, so core withholds it from non-admin subscribers. A
 * non-admin never receiving this variant is correct behaviour, not a gap.
 */
export interface CascadeProgressData {
    /** Hex-encoded descendant subgroup id, never the namespace root the event is
     * keyed on. */
    subgroupId: string;
    localContextsSwapped: number;
    /** Contexts the emitting node holds for THIS SUBGROUP. Node-local and
     * per-subgroup; unrelated to both sibling totals. */
    localContextsTotal: number;
}
/** Every pinned-cohort member reported the target version. */
export interface MigrationCompletedData {
    toVersion: string;
    /** FLEET convergence, in seconds since the epoch: the same stamp
     * `MigrationStatus.fleetCompletedAt` returns. Not `GroupUpgradeStatus.completedAt`,
     * which is this node's own local swap completion. */
    completedAt: number;
}
/**
 * Parsed group-migration event (core's `GroupMigration` `NodeEvent` variant),
 * keyed on the namespace root a client subscribes with.
 *
 * `MigrationStarted`, `MigrationProgress` and `MigrationCompleted` reach every
 * subscribed member; `CascadeProgress` reaches namespace admins only.
 */
export type GroupMigrationEventData = {
    groupId: string;
    type: 'MigrationStarted';
    data: MigrationStartedData;
} | {
    groupId: string;
    type: 'MigrationProgress';
    data: MigrationProgressData;
} | {
    groupId: string;
    type: 'CascadeProgress';
    data: CascadeProgressData;
} | {
    groupId: string;
    type: 'MigrationCompleted';
    data: MigrationCompletedData;
};
/** Narrows a raw `'event'` payload to the group-migration family by its tag. */
export declare function isGroupMigrationEvent(event: {
    type?: string;
}): event is GroupMigrationEventData;
