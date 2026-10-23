# Mero Leads

An inbox for a website's contact form, and the pipeline a team moves those
leads through. The website's backend submits each lead with a **form key**;
the team logs in to the app, sees every lead, edits it and moves it from New
to Won. There is no database or server of the team's own in between: the
leads live in one Calimero context — the inbox — replicated between the
team's nodes.

What using it looks like:

- **A board and a list.** Columns per status (New, Contacted, Qualified, Won,
  Lost), drag a card to move it, or open it and press "Move to …". Search,
  "Mine", a Spam view and a CSV export.
- **Edit a lead without losing what was sent.** Name, email and company
  corrections are an overlay: the panel shows "Sent as: …" beside a changed
  field, and clearing the field goes back to the original. Notes and an
  owner from the team.
- **A team.** Admins add namespace members to the team, or remove them.
  Joining the namespace is not joining the team: a member who is not on it
  sees "Waiting to be added to the team".
- **Form keys, issued from the app.** An admin creates one per website form
  in the **Forms** tab, copies the environment variables into the site's
  backend once, sees how many leads each key has sent, and revokes it.

## Form keys

A form key is an account with a certified device and no node. Issuing one,
all from the admin's browser tab (`app/src/FormKeys.tsx`):

1. mint the account and its device certificate in the tab
   (`app/src/lib/formKey.ts`), so the secret exists nowhere until the admin
   copies it;
2. have the admin's node create an invitation to the inbox's namespace;
3. present the new account's signed join to that node, which makes it a plain
   member (`bootstrapFromInvitation`);
4. register it in the contract (`register_form_key`), which labels it and
   keeps it off the team.

The app then shows, once:

```
CALIMERO_CONTEXT_ID=…
CALIMERO_FORM_ACCOUNT=…
CALIMERO_FORM_CREDENTIAL=…
CALIMERO_FORM_DEVICE_SECRET=…
```

The website's backend signs a warrant for `submit_lead` with these and sends
it to a relay with `RelayClient.execute` from `@calimero-network/mero-js`; the
relay runs the call as the form key's account. The key can submit and nothing
else, because only the team may read or change leads. Revoking removes its
namespace membership (what lets it write) and then its registration (what
names it).

**The relay.** A website needs a node that relays for the namespace:

- Make the namespace always-on in Calimero Desktop and Calimero Cloud's nodes
  relay for it.
- Or use a node of the team's own. An admin grants it `CAN_AUTHOR_ON_BEHALF`
  from the Forms tab ("Let this node write for form keys"), its operator runs
  it with `merod … init --delegated-access` (which serves the warrant route
  without a node credential), and the site's `CALIMERO_RELAY_URL` points at it.

## The contract in one table

| State | Tier | Why |
| --- | --- | --- |
| `submissions: UnorderedMap<id, LwwRegister<Submission>>` | public, insert-only | What the visitor sent, with `created_at` and `submitted_by`. `submit_lead` refuses an existing id and nothing else writes it. |
| `pipeline: SharedStorage<UnorderedMap<id, Pipeline>>` | writers = the team | Status, notes, owner, contact corrections. Every field a register, so two teammates editing different fields both keep their change. A pipeline write from anyone else is rejected at merge on every node. |
| `settings: SharedStorage<UnorderedMap<key, LwwRegister<String>>>` | writers = the team | The inbox's display name. |
| `form_keys: SharedStorage<UnorderedMap<account, FormKey>>` | writers = the admins | Which members are form keys, with a label. The register, not the grant: membership is the grant. |
| `roles: AccessControl` | admins | The admins (the installer to start with) and the `team` role. Adding or removing a teammate rotates the writers of `pipeline` and `settings`. |

**Why submissions are not owned storage.** `WriteOnce` would make a
submission immutable for every node, but core lets only an attested TEE relay
(`RelayTee`) sign an owned entry on a member's behalf. Owned submissions would
make every lead depend on Calimero Cloud's fleet, and a team's own node could
never relay one. So insert-only is enforced by the contract, which binds honest
nodes: a patched *member* node could overwrite a submission. Every member node
already holds every lead, so that is a member misbehaving inside the boundary,
not a way in.

Statuses are `new`, `contacted`, `qualified`, `won`, `lost` and `spam`; a
status a patched node wrote outside that set reads as `new`. Events carry ids
and the source page, never contact details.

### Methods

| Method | Who | Does |
| --- | --- | --- |
| `submit_lead(name, email, company, message, source)` | any member | Store a lead; returns its id |
| `list_leads()` / `get_lead(id)` | team | Leads, newest first, with the overlay laid over the submission |
| `update_lead(id, changes)` | team | Change any of status, notes, owner, name, email, company (`null` leaves a field) |
| `set_status(id, status)` / `statuses()` | team / anyone | Move a lead; the pipeline's statuses |
| `list_team()` / `add_team_member(who)` / `remove_team_member(who)` | team / admin | The team |
| `inbox_name()` / `set_inbox_name(name)` | anyone / team | The inbox's name |
| `register_form_key(account, label)` / `forget_form_key(account)` / `list_form_keys()` | admin | The form key register, with each key's lead count and last lead |
| `am_i_team()` / `am_i_admin()` / `my_account()` | anyone | Identity |

## Run it

```bash
cargo test -p mero-leads                           # contract tests, no node
cargo mero bundle --manifest-path apps/mero-leads/logic/Cargo.toml \
  --dev --app-version 0.0.0 \
  --output apps/mero-leads/logic/dist/com.calimero.mero-leads.mpk
pnpm -F mero-leads codegen                         # ABI -> src/generated
pnpm -F mero-leads dev                             # http://localhost:5198

pnpm -F mero-leads test                            # unit tests
pnpm -F mero-leads test:e2e                        # Playwright against a real merod
cd apps/mero-leads/logic && merobox bootstrap run workflows/e2e.yml   # two nodes
```

The Playwright journey is the whole product path on one node: log in, issue a
form key from the Forms tab, let the node relay, submit a lead with
`RelayClient` as a website would, drag it across the board, edit it, reload,
check the key's count, revoke it, and see the next submission refused.

## Layout

```
logic/src/lib.rs            the contract
logic/src/tests.rs          TestHost tests: the team, form keys, edits, writers
logic/workflows/e2e.yml     merobox: two nodes, every method, the access rules
app/src/App.tsx             top bar, inbox name, account menu, tabs, not-on-team state
app/src/LeadsBoard.tsx      board and list, search, filters, drag to move, CSV
app/src/LeadPanel.tsx       one lead: status, move on, contact overlay, owner, notes
app/src/TeamCard.tsx        the team, members not on it, invitations
app/src/FormKeys.tsx        issue, count and revoke form keys; this node as a relay
app/src/lib/                pure, unit-tested: pipeline, form key minting, people
app/src/useInbox.ts         the generated client + re-read on sync events
app/src/{ContextPicker,InviteCard,useJoinFromInvitation}.tsx, utils/
                            login, inbox selection and invites, from kv-store
app/e2e/                    Playwright against a native merod
```

The frontend is not deployed yet: `frontend` in `logic/Cargo.toml` names
`https://mero-leads.vercel.app`, which needs a Vercel project with Root
Directory `apps/mero-leads/app` (see [docs/VERCEL.md](../../docs/VERCEL.md)).

Mero Leads overlaps [mero-crm](../mero-crm) on purpose only at the pipeline: it
is the inbox a public form writes into, small enough to put behind a website,
where mero-crm is a full CRM for deals a team enters itself.
