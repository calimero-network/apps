// Which context IS the registry for a namespace — and when the honest answer
// is "I don't know yet".
//
// ⚠️ THIS FILE EXISTS BECAUSE `contexts[0]` IS NOT AN ANSWER.
//
// The app used to read `useGroupContexts(ns).contexts[0].contextId`. That is
// whatever the node happened to list first, and the ordering is neither stable
// across reloads nor the same on two nodes — so two peers could disagree about
// which context is the registry for one namespace, and a user who created
// folders saw an empty workspace after a refresh. Measured on a live pair: one
// namespace, THREE registry contexts, the folders in the second of them.
//
// The three existed because of the second half of the same bug. The lazy-create
// fallback minted a registry whenever the context list came back empty, and an
// empty list has TWO causes that look identical from here:
//
//     (a) this namespace genuinely has no registry yet          → mint one
//     (b) replication has not delivered it to THIS node yet     → wait
//
// Treating (b) as (a) mints a fresh, empty registry on every observation — on a
// reload, on a second node, on a re-render after a failed governance op. Each
// one then competes to be `contexts[0]`.
//
// So this module answers with three outcomes, not one, and the caller is
// obliged to handle "unsynced" differently from "absent".
//
// THE IDENTIFICATION MECHANISM, in order of authority:
//
//   1. A PIN in the namespace root group's metadata `data` map. Group metadata
//      replicates to every member — it is the same channel a workspace's name
//      travels on — so a pin written once by the creator is the one fact both
//      nodes can agree on without agreeing about list order. This is the only
//      mechanism that is stable by construction; everything below is recovery
//      for namespaces created before the pin existed.
//
//   2. THE ONE THAT HOLDS THE DATA. For a legacy namespace with duplicates,
//      picking by name or by id would be deterministic and would still show the
//      user an empty workspace, because their folders are in the other one.
//      Whichever context answers `get_folders()` with the most rows is the one
//      that was really being used, and adopting it is what makes the existing
//      data reappear.
//
//   3. NAME, then LOWEST ID. Contexts are created with `name: 'Registry'`, so a
//      named one beats an unnamed one; ties break on the lexicographically
//      smallest context id, which every node computes identically. Never list
//      order.
//
// Whatever 2 or 3 chooses is then WRITTEN BACK as the pin, so the guess happens
// once per namespace and every later read — on every node — is mechanism 1.

/** Key under the root group's metadata `data` map. */
export const REGISTRY_PIN_KEY = 'mero-drive.registryContext';

/** How the answer was reached. Surfaced so the UI can explain a recovery. */
export type RegistrySource = 'pin' | 'sole' | 'data' | 'named' | 'lowest-id';

export interface RegistryCandidate {
  contextId: string;
  /** `listGroupContexts` label. `'Registry'` for anything this app created. */
  name?: string;
}

export interface ResolveInput {
  /** `metadata.data[REGISTRY_PIN_KEY]` from the namespace ROOT group, if any. */
  pin: string | null;
  /** What `listGroupContexts(namespaceId)` returned on THIS node. */
  listed: readonly RegistryCandidate[];
  /**
   * `getGroupInfo(namespaceId).contextCount` — how many contexts the GROUP
   * believes it has, which is governance state and arrives separately from the
   * contexts themselves. `null` when unknown.
   *
   * This is the signal that separates "empty because new" from "empty because
   * unsynced", and it is the whole reason a second node stops minting.
   */
  reportedCount: number | null;
  /**
   * `get_folders().length` per context id, when it has been probed. Absent
   * entries mean "not probed"; probing is only worth it when there is more
   * than one candidate.
   */
  folderCounts?: Readonly<Record<string, number>> | null;
}

export type RegistryResolution =
  | {
      status: 'resolved';
      contextId: string;
      source: RegistrySource;
      /** Every other candidate. Non-empty means this namespace has duplicates. */
      duplicates: string[];
    }
  | {
      /** A registry exists but has not reached this node. NEVER mint here. */
      status: 'unsynced';
      reason: string;
    }
  | {
      /** No registry, and nothing says one is coming. Minting is allowed. */
      status: 'absent';
    };

/** Stable across nodes: the same inputs give the same winner everywhere. */
function pickDeterministic(
  candidates: readonly RegistryCandidate[],
  registryName: string,
  folderCounts?: Readonly<Record<string, number>> | null,
): { contextId: string; source: RegistrySource } {
  const byId = [...candidates].sort((a, b) =>
    a.contextId < b.contextId ? -1 : a.contextId > b.contextId ? 1 : 0,
  );

  // 2. The one that holds the data — adopting beats orphaning.
  if (folderCounts) {
    const withData = byId.filter((c) => (folderCounts[c.contextId] ?? 0) > 0);
    if (withData.length > 0) {
      // Most rows wins; `byId` order already breaks the tie deterministically
      // because `reduce` keeps the incumbent on equality.
      const best = withData.reduce((winner, c) =>
        (folderCounts[c.contextId] ?? 0) > (folderCounts[winner.contextId] ?? 0)
          ? c
          : winner,
      );
      return { contextId: best.contextId, source: 'data' };
    }
  }

  // 3a. Name, then 3b. lowest id.
  const named = byId.find((c) => c.name === registryName);
  if (named) return { contextId: named.contextId, source: 'named' };
  return { contextId: byId[0].contextId, source: 'lowest-id' };
}

export function resolveRegistryContext(
  input: ResolveInput,
  registryName: string,
): RegistryResolution {
  const listed = input.listed ?? [];
  // Sorted, not in list order: `duplicates` is compared and displayed, and
  // leaving it in whatever order the node listed would reintroduce exactly the
  // node-dependent ordering this module exists to remove — just one field over.
  const others = (winner: string) =>
    listed
      .map((c) => c.contextId)
      .filter((id) => id !== winner)
      .sort();

  // 1. The pin is authoritative — including when it names something this node
  //    has not received. That case is precisely the one that used to mint a
  //    duplicate: the registry demonstrably exists, because a member wrote its
  //    id into replicated group metadata.
  if (input.pin) {
    if (listed.some((c) => c.contextId === input.pin)) {
      return {
        status: 'resolved',
        contextId: input.pin,
        source: 'pin',
        duplicates: others(input.pin),
      };
    }
    return {
      status: 'unsynced',
      reason:
        'This workspace names a registry context that has not reached this node yet.',
    };
  }

  // No pin. The group's own count is the only thing that can tell an
  // incomplete list from a complete one.
  const reported = input.reportedCount;
  if (reported !== null && reported > listed.length) {
    return {
      status: 'unsynced',
      reason:
        listed.length === 0
          ? `This workspace reports ${reported} context${reported === 1 ? '' : 's'}, none of which has reached this node yet.`
          : `This workspace reports ${reported} contexts but only ${listed.length} ${listed.length === 1 ? 'has' : 'have'} reached this node.`,
    };
  }

  if (listed.length === 0) {
    // `reported === null` means we could not read the group's count at all —
    // which is not evidence of absence. Refusing to mint on unknown is the
    // safe direction: a missing registry is recoverable by an admin, a
    // duplicate one silently splits the workspace in two.
    if (reported === null) {
      return {
        status: 'unsynced',
        reason: 'This workspace has not reported its contexts yet.',
      };
    }
    return { status: 'absent' };
  }

  if (listed.length === 1) {
    return {
      status: 'resolved',
      contextId: listed[0].contextId,
      source: 'sole',
      duplicates: [],
    };
  }

  const picked = pickDeterministic(listed, registryName, input.folderCounts);
  return {
    status: 'resolved',
    contextId: picked.contextId,
    source: picked.source,
    duplicates: others(picked.contextId),
  };
}

/**
 * Whether the resolved id should be written back as the pin.
 *
 * Only for an answer that was GUESSED. Re-writing a pin we just read from the
 * pin is a pointless governance op on every namespace switch, and `'sole'` is
 * worth pinning precisely because a second context appearing later must not be
 * able to change the answer.
 */
export function shouldAdoptPin(resolution: RegistryResolution): boolean {
  return resolution.status === 'resolved' && resolution.source !== 'pin';
}

/**
 * The `data` map to send when pinning.
 *
 * ⚠️ `SetMetadataRequest` WHOLLY REPLACES the record: the server defaults
 * `data` to `{}` and stores that, so sending `{data: {pin}}` alone would delete
 * every other key the group carries. Merge onto what is already there.
 */
export function pinnedMetadataData(
  existing: Readonly<Record<string, string>> | null | undefined,
  contextId: string,
): Record<string, string> {
  return { ...(existing ?? {}), [REGISTRY_PIN_KEY]: contextId };
}

/** Read the pin out of a group metadata record, tolerating every absent shape. */
export function readPin(
  metadata: { data?: Record<string, string> | null } | null | undefined,
): string | null {
  const v = metadata?.data?.[REGISTRY_PIN_KEY];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
