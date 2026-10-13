import type { PlanInput, PlannedOp } from "./types";

export function plan(input: PlanInput): PlannedOp[] {
  const ops: PlannedOp[] = [];
  // Org admins (and app admins, who are org admins when they registered) are never removed or re-capped.
  const admins = new Set([...input.orgAdmins, ...input.apps.map((a) => a.admin_account)]);
  const groupName = new Map(input.groups.map((g) => [g.id, g.name]));
  const enrolment = new Map(input.enrolments.map((e) => [`${e.account}:${e.app}`, e]));

  for (const app of input.apps) {
    if (app.status !== "ready") continue;
    const observed = input.observed.find((o) => o.appId === app.id);
    if (!observed) continue;
    const placements = input.placements.filter((p) => p.app === app.id);
    // Only subgroups this org stamped are ours; another org sharing the app namespace keeps its own.
    const mapped = observed.subgroups.filter((s) => s.orgGroupId && s.org === input.orgNamespaceId);
    const byGroup = new Map(mapped.map((s) => [s.orgGroupId as string, s]));
    // accounts with a governance op this round: a stored `failed` row stays until that op succeeds
    const retrying = new Set<string>();

    // 0. members' nodes follow the namespace from this node: keep its addresses current
    if (input.peerAddrs && !sameList(input.peerAddrs, app.peer_addrs)) {
      ops.push({ kind: "set-app-peers", app: app.id, peerAddrs: input.peerAddrs });
    }

    // 1. missing subgroups
    const wantedGroups = [...new Set(placements.map((p) => p.group))].sort();
    const creating = new Set<string>();
    for (const g of wantedGroups) {
      if (!byGroup.has(g)) { creating.add(g); ops.push({ kind: "create-subgroup", app: app.id, orgGroupId: g, name: groupName.get(g) ?? g }); }
    }

    // 2-3. per account
    const accounts = [...new Set(placements.map((p) => p.account))].sort();
    const stateFor = new Map<string, { state: string; subgroups: string[] }>();
    for (const account of accounts) {
      const mine = placements.filter((p) => p.account === account);
      const key = `${account}:${app.id}`;
      // Added at the root directly: the account's node follows the namespace, so no invitation.
      // The subgroup adds below run after it in the same pass.
      if (!observed.rootMembers.has(account)) {
        retrying.add(key);
        ops.push({ kind: "add-root-member", app: app.id, account });
      }
      const placedIn: string[] = [];
      let allPlaced = true;
      for (const p of mine) {
        const sg = byGroup.get(p.group);
        if (!sg) { allPlaced = false; continue; }
        if (sg.members.has(account)) {
          placedIn.push(sg.groupId);
          // 3b. a capability change on the access row reaches people already placed
          const caps = sg.capabilities.get(account);
          if (!admins.has(account) && caps !== undefined && caps !== p.capabilities) {
            retrying.add(key);
            ops.push({ kind: "set-capabilities", app: app.id, subgroupId: sg.groupId, orgGroupId: p.group, account, capabilities: p.capabilities });
          }
          continue;
        }
        retrying.add(key);
        ops.push({ kind: "add-member", app: app.id, subgroupId: sg.groupId, orgGroupId: p.group, account, capabilities: p.capabilities });
        allPlaced = false;
      }
      stateFor.set(key, { state: allPlaced && !creating.size ? "placed" : "added", subgroups: placedIn.sort() });
    }

    // 4. removals
    const wanted = new Set(placements.map((p) => `${p.account}:${p.group}`));
    for (const sg of mapped) {
      for (const member of [...sg.members].sort()) {
        if (admins.has(member) || wanted.has(`${member}:${sg.orgGroupId}`)) continue;
        retrying.add(`${member}:${app.id}`);
        ops.push({ kind: "remove-member", app: app.id, subgroupId: sg.groupId, orgGroupId: sg.orgGroupId as string, account: member });
      }
    }

    // 4b. people who left the org leave the namespace root too
    for (const account of [...input.leftAccounts].sort()) {
      if (observed.rootMembers.has(account) && !admins.has(account)) {
        retrying.add(`${account}:${app.id}`);
        ops.push({ kind: "remove-member", app: app.id, subgroupId: app.id, orgGroupId: "", account });
      }
    }

    // 5. records — a `failed` row is left alone while its retry op is in flight
    for (const [key, next] of stateFor) {
      const [account] = key.split(":") as [string, string];
      const stored = enrolment.get(key);
      if (stored?.state === "failed" && retrying.has(key)) continue;
      const same = stored && stored.state === next.state && stored.subgroups.length === next.subgroups.length && stored.subgroups.every((s, i) => s === next.subgroups[i]);
      if (!same) ops.push({ kind: "record", account, app: app.id, state: next.state, subgroups: next.subgroups, note: "" });
    }
    for (const e of input.enrolments) {
      const key = `${e.account}:${e.app}`;
      if (e.app !== app.id || stateFor.has(key) || e.state === "removed") continue;
      if (e.state === "failed" && retrying.has(key)) continue;
      ops.push({ kind: "record", account: e.account, app: app.id, state: "removed", subgroups: [], note: "" });
    }
  }

  // 6. people who left the org leave the org namespace root
  for (const account of [...input.leftAccounts].sort()) {
    if (input.orgRootMembers.has(account) && !admins.has(account)) {
      ops.push({ kind: "remove-member", app: input.orgNamespaceId, subgroupId: input.orgNamespaceId, orgGroupId: "", account });
    }
  }
  return ops;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
