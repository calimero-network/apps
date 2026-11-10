# Calimero Home

One place for an organization: the apps it holds, who is in each, invitations,
and removing someone from every app at once. A Calimero app like the others,
served by every cluster from its own bundle (`com.calimero.mero-home`), so it
signs people in with their passkey on the cluster's own origin.

Home keeps no state. Everything it shows and changes is the organization's,
through core's org routes and mero-js (`getOrg`, `listAppTeams`, `getTeam`,
`listInvites`, `revokeInvite`, `invite`, `scopeApps`,
`setTeamDefaultCapabilities`, `removeMember`). The contract in `logic/` exists
because a package has to hold a component; it answers `about` and nothing else.

```
apps/mero-home/
├── logic/                 the stub component (about), its scenario and ABI
└── app/
    ├── src/home.ts        what Home reads and decides (no React): org view, apps, rosters, who may do what
    ├── src/Home.tsx       org picker, then the screens the person gets
    ├── src/screens/       Your apps, People, Invitations, Admin
    └── e2e/               Playwright on merod local (waits for a core release, below)
```

## The model

Each app installed in an organization has its own **app team** (core#4890), and
an invite names the app teams it gives. The node derives the org's mode:

- **legacy**: no app teams; every app uses organization access (how every org
  held its apps before). Home lists those apps as "Everyone in the organization"
  and offers an admin "Give it its own access list", which keeps everyone who
  has it.
- **standalone**: open app teams; the org is one app's, and its members may
  invite (the team default holds `INVITE_MEMBERS`).
- **shared**: closed app teams; each app lists its people.

The shared helpers (`appTeamOf`, `createAppTeam`, `ensureAppTeam`,
`inviteToApp`, `appAccess`, `setMembersMayInvite`) are in
[`@calimero-apps/connect`](../../packages/connect/README.md#app-teams), for
every app to use.

## Who gets what (the owner's decisions)

| | Your apps | People | Invitations | Admin |
|---|---|---|---|---|
| owner, admin | all apps, open links for theirs | everyone, per-app matrix, remove from org | invite to any app, any role; every pending invite | add apps, legacy to app team, "members may invite" per app |
| app lead | their apps | as a member | invite to the apps they lead | - |
| member | their apps | shared org: people sharing an app with them, and admins (core filters) | only to apps whose "members may invite" is on (always in standalone) | - |
| guest | the apps they were invited to | none: app-only, no directory | - | - |

1. Members invite to their app in standalone mode; in shared mode only leads
   and admins by default, with a per-app switch.
2. Chat-only members see only Chat's people; admins see everyone.
3. A guest is app-only, with no directory.
4. Only admins install apps.
5. Home is one Calimero app on every cluster.
6. Admins can remove someone from the organization, and so from all its apps
   (core#4891), behind a confirm that names those apps.

## Run it

```bash
pnpm install
pnpm -F mero-home test          # unit + component tests (mocked client)
pnpm -F mero-home typecheck
pnpm dev:local mero-home        # merod local + the dev server on :5173
```

On a node without the app-team routes (core before #4890), Home still opens:
every app reads as legacy and invites are org-wide, as apps send them today.

## The e2e suite waits for a core release

`app/e2e/home.spec.ts` runs Home in Chromium (virtual authenticator) against
`merod local`: an admin joins from an invite, gives a legacy KV Store its own
access list, invites to it, lists and revokes pending invites, the invitee sees
only that app, and the admin removes them from the org. It needs core#4890 and
#4891 in a release; 1.0.0-rc.13 has neither, so it is not in CI and its global
setup refuses an older merod with that reason. When the release lands, move
`component-core-tag` to it and add this app to the browser e2e legs. Until
then: `MEROD_BIN=/path/to/merod-from-master pnpm -F mero-home test:e2e`.
