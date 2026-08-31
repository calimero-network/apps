// ── Workspace structure ─────────────────────────────────────────────────────
// A team is a Calimero namespace; each team owns exactly one shared calendar
// context (collapsing mero-pixart's Teams→Projects→Editor into Teams→Calendar).

export interface Team {
  groupId: string; // namespace id
  name: string;
}
