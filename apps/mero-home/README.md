# Calimero Home

One place for an organization: the apps it holds, who is in each, invitations,
and removing someone from every app at once. A Calimero app like the others,
served by every cluster from its own bundle (`com.calimero.mero-home`), so it
signs people in with their passkey on the cluster's own origin.

Home keeps no state. Everything it shows and changes is the organization's,
through core's org routes and mero-js (`getOrg`, `listAppTeams`, `getTeam`,
`listInvites`, `revokeInvite`, `invite`, `scopeApps`,
`setTeamDefaultCapabilities`, `removeMember`, `deleteTeam`, `setOrgMetadata`,
`setMember`, `deleteOrg`). The contract in `logic/` exists
because a package has to hold a component; it answers `about` and nothing else.

```
apps/mero-home/
├── logic/                 the stub component (about), its scenario and ABI
└── app/
    ├── src/home.ts        what Home reads and decides (no React): org view, apps, rosters, who may do what
    ├── src/Home.tsx       org picker, then the screens the person gets
    ├── src/screens/       Your apps, People, Invitations, Admin, Organization
    └── e2e/               Playwright on merod local (CI: components.yml `browser`)
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
| owner, admin | all apps, open links for theirs | everyone, per-app matrix (set who is in each closed app: No, Member, Read only, Lead), remove from org | invite to any app, any role; every pending invite | add apps, remove an app, legacy to app team, "members may invite" per app; Organization: name and logo (owner only: transfer ownership, delete the org) |
| app lead | their apps | as a member, and sets who is in the apps they lead | invite to the apps they lead | - |
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

## Removing an app, and the organization's settings

- **Remove app** (Admin, owners and admins): `deleteTeam` on the app's team
  deletes every instance on it and on the teams below it (a private
  channel's), with their data. The confirm lists those instances, read from
  the node first (`appTeamInstances` in `@calimero-apps/connect`), and the
  admin types the app's name; core asks for a passkey when there is an
  instance to delete, none otherwise. A legacy app has no team, so no
  removal is offered there.
- **Organization** screen (owners and admins): the name and logo Home shows,
  kept in the org's metadata (`displayName`, `logo`: an image `data:` URL of
  at most 12 KiB, scaled to 96 px; the served page's CSP takes no other image
  origin). No passkey. Core has no rename, so the name the org was made with
  stays its name in other apps and invitations.
- **Transfer ownership** and **Delete the organization**: the owner only,
  one passkey each. A transfer makes the owner an admin. A delete needs the
  organization's name typed, and core refuses it while the org owns a
  deployment.
- The recovery key and release approvals stay in the Calimero console.

## Run it

```bash
pnpm install
pnpm -F mero-home test          # unit + component tests (mocked client)
pnpm -F mero-home typecheck
pnpm dev:local mero-home        # merod local + the dev server on :5173
```

On a node without the app-team routes (core before #4890), Home still opens:
every app reads as legacy and invites are org-wide, as apps send them today.

## The e2e suite

`app/e2e/home.spec.ts` runs Home in Chromium (virtual authenticator) against
`merod local`: an admin joins from an invite, gives a legacy KV Store its own
access list, invites to it, lists and revokes pending invites, the invitee sees
only that app, the admin sets the name Home shows, removes the invitee from
the org, and removes the app with its instance. It needs core#4890 and
#4891, first released in 1.0.0-rc.14 (the pinned `component-core-tag`); its
global setup refuses an older merod with that reason. CI runs it in
`components.yml`'s `browser` job. By hand: `MEROD_BIN=/path/to/merod-rc.14
pnpm -F mero-home test:e2e`.
