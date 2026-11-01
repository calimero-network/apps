# Recipe: public / private rooms (teams + app access)

**Problem the base has:** every room is reachable by the whole organization
(`createApp(name, source, { org })`), so there is no per-room membership.

**This recipe:** each room is a **team** of the organization plus an app
instance whose access is that team:

- `join: 'everyone'` → **public**: everyone who reaches the organization is a
  member (unless an admin denied them `JOIN_OPEN_TEAMS`).
- `join: 'invite'` → **private**: only the accounts added with `setTeamMember`
  (a passkey step-up).

```
organization (workspace)
├── team "general"  everyone → app instance, access { kind: 'team', team }
└── team "founders" invite   → app instance, access { kind: 'team', team }
```

1. `createTeam(org, name, join)` → `teamId`
2. `createApp(name, source, { org, access: { kind: 'team', team: teamId } })`
3. private only: `setTeamMember(org, teamId, account, passkey)` per member

`listApps({ package })` lists only the rooms the caller reaches, so the room
list needs no filtering of its own. `useTeamRooms.ts` is a drop-in hook.
