# @calimero-apps/cloud

The API the apps are written against (v1's `@calimero-network/mero-react` and
`mero-js` names), running on Calimero Cloud's attested client.

- `src/backend.ts` — the cluster behind v1's names: `CloudMero` (client, `rpc`,
  `events`, `ephemeral`), `CloudAdmin` (namespaces → organizations, groups →
  teams, contexts → app instances, packages), passkey session, invitations.
- `src/react.js` — v1's hooks and invitation handling, carried over; the
  provider and sign-in UI use passkeys on the cluster.
- `src/testing.ts` (`@calimero-apps/cloud/testing`) — an in-memory cluster for
  app tests.
- `vite.mjs` (`@calimero-apps/cloud/vite`) — the production CSP `<meta>`.
- `types/` — v1's declarations (so apps compile unchanged) plus the cloud
  additions.

See `docs/RELEASE-V2.md` ("Frontends") for the mapping and the defaults.
