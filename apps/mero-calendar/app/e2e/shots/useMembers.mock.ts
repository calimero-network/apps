// Fixture for the peer autocomplete. The real hook reads redux, which is fed by
// the node; nothing else in the create-event modal needs one.
export function shortPk(pk: string): string {
  return pk.length > 12 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk;
}

const MEMBERS = [
  { id: "a1".repeat(32), username: "ana" },
  { id: "b2".repeat(32), username: "bruno" },
  { id: "c3".repeat(32), username: "" },
];

export function useMembers() {
  const byId = new Map(MEMBERS.map((m) => [m.id, m]));
  return {
    members: MEMBERS,
    byId,
    displayName: (pk: string) => byId.get(pk)?.username?.trim() || shortPk(pk),
  };
}
