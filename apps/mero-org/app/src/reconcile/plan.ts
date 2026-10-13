import type { PlanInput, PlannedOp } from "./types";

export function plan(input: PlanInput): PlannedOp[] {
  const ops: PlannedOp[] = [];
  const admins = new Set(input.apps.map((a) => a.admin_account));
  const groupName = new Map(input.groups.map((g) => [g.id, g.name]));
  const enrolment = new Map(input.enrolments.map((e) => [`${e.account}:${e.app}`, e]));

  for (const app of input.apps) {
    if (app.status !== "ready") continue;
    const observed = input.observed.find((o) => o.appId === app.id);
    if (!observed) continue;
    const placements = input.placements.filter((p) => p.app === app.id);
    const byGroup = new Map(observed.subgroups.filter((s) => s.orgGroupId).map((s) => [s.orgGroupId as string, s]));

    // 1. missing subgroups
    const wantedGroups = [...new Set(placements.map((p) => p.group))].sort();
    const creating = new Set<string>();
    for (const g of wantedGroups) {
      if (!byGroup.has(g)) { creating.add(g); ops.push({ kind: "create-subgroup", app: app.id, orgGroupId: g, name: groupName.get(g) ?? g }); }
    }

    // 2-3. per account
    const accounts = [...new Set(placements.map((p) => p.account))].sort();
    const minted = new Set<string>();
    const stateFor = new Map<string, { state: string; subgroups: string[] }>();
    for (const account of accounts) {
      const mine = placements.filter((p) => p.account === account);
      const key = `${account}:${app.id}`;
      const stored = enrolment.get(key);
      if (!observed.rootMembers.has(account)) {
        const live = stored?.state === "invitation_pending" && stored.invitation_expires > input.now;
        if (!live && !minted.has(account)) { minted.add(account); ops.push({ kind: "mint-invitation", app: app.id, account }); }
        stateFor.set(key, { state: "invitation_pending", subgroups: [] });
        continue;
      }
      const placedIn: string[] = [];
      let allPlaced = true;
      for (const p of mine) {
        const sg = byGroup.get(p.group);
        if (!sg) { allPlaced = false; continue; }
        if (sg.members.has(account)) { placedIn.push(sg.groupId); continue; }
        ops.push({ kind: "add-member", app: app.id, subgroupId: sg.groupId, orgGroupId: p.group, account, capabilities: p.capabilities });
        allPlaced = false;
      }
      stateFor.set(key, { state: allPlaced && !creating.size ? "placed" : "joined", subgroups: placedIn.sort() });
    }

    // 4. removals
    const wanted = new Set(placements.map((p) => `${p.account}:${p.group}`));
    for (const sg of observed.subgroups) {
      if (!sg.orgGroupId) continue;
      for (const member of [...sg.members].sort()) {
        if (admins.has(member) || wanted.has(`${member}:${sg.orgGroupId}`)) continue;
        ops.push({ kind: "remove-member", app: app.id, subgroupId: sg.groupId, orgGroupId: sg.orgGroupId, account: member });
      }
    }

    // 4b. people who left the org leave the namespace root too
    for (const account of [...input.leftAccounts].sort()) {
      if (observed.rootMembers.has(account) && !admins.has(account)) {
        ops.push({ kind: "remove-member", app: app.id, subgroupId: app.id, orgGroupId: "", account });
      }
    }

    // 5. records
    for (const [key, next] of stateFor) {
      const [account] = key.split(":") as [string, string];
      const stored = enrolment.get(key);
      const same = stored && stored.state === next.state && stored.subgroups.length === next.subgroups.length && stored.subgroups.every((s, i) => s === next.subgroups[i]);
      if (!same) ops.push({ kind: "record", account, app: app.id, state: next.state, subgroups: next.subgroups, note: "" });
    }
    for (const e of input.enrolments) {
      if (e.app !== app.id || stateFor.has(`${e.account}:${e.app}`) || e.state === "removed") continue;
      ops.push({ kind: "record", account: e.account, app: app.id, state: "removed", subgroups: [], note: "" });
    }
  }
  return ops;
}
