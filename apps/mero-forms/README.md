# Mero Forms

Forms with the questions you choose, the responses they collect, and a one-click
hand-off of any response to [Mero CRM](../mero-crm). A workspace of forms is one
Calimero context, replicated between the team's own nodes: there is no form
service in the middle, and nobody outside the team can read a response.

What using it looks like:

- **Build a form** from a template (Contact us, Request a demo, Feedback) or
  from scratch. Nine kinds of question: short answer, paragraph, email, phone,
  number, website, date, multiple choice and checkboxes. Each can be required
  and carry help text; questions reorder, duplicate and delete. Close a form to
  stop new responses.
- **Collect responses** three ways: a public link anyone can open and answer
  without signing in, a website's backend answering with a form key (below),
  or a teammate entering one by hand from **Preview**. The contract
  checks every answer against its question, so a stale or tampered website
  fails loudly instead of storing junk.
- **Read them**: a summary of every choice question, a searchable table
  (New, All, In CRM, Archived), one response in full, CSV export.
- **Send to CRM**: link a form to a Mero CRM pipeline once, map which question
  is the contact's name, email, phone and organization, then send a response
  (or all new ones). Each becomes a contact (reused when the email matches), a
  deal in the stage you chose, and a note on the deal with every answer.
- **A team**: admins add namespace members to the team, or remove them.
  Joining the namespace is not joining the team: a member who is not on it
  sees "Waiting to be added to the team".

## Form keys

A form key is an account with a certified device and no node, bound to one
form. An admin issues one from the form's **Connect** tab, all in the browser
(`app/src/FormConnect.tsx`):

1. mint the account and its device certificate in the tab
   (`app/src/lib/formKey.ts`), so the secret exists nowhere until the admin
   copies it;
2. have the admin's node create an invitation to the workspace's namespace;
3. present the new account's signed join to that node, which makes it a plain
   member (`bootstrapFromInvitation`);
4. register it in the contract (`register_form_key`), which binds it to this
   form, labels it and keeps it off the team.

The app then shows, once:

```
CALIMERO_CONTEXT_ID=…
CALIMERO_FORM_ID=…
CALIMERO_FORM_ACCOUNT=…
CALIMERO_FORM_CREDENTIAL=…
CALIMERO_FORM_DEVICE_SECRET=…
```

The website's backend signs a warrant for `submit_response` with these and
sends it to a relay with `RelayClient.execute` from `@calimero-network/mero-js`:

```json
{
  "form_id": "<CALIMERO_FORM_ID>",
  "answers": [
    { "field_id": "name", "values": ["Ada Lovelace"] },
    { "field_id": "email", "values": ["ada@example.com"] },
    { "field_id": "topic", "values": ["Cloud"] }
  ],
  "source": "/contact/"
}
```

One answer per question, under the question's id (shown on each question in
**Edit**, and as a full example in **Connect**). A choice is one of its
options; checkboxes any of them. The key can answer its form and nothing else:
it cannot read responses, change a form or answer another one. Revoking removes
its namespace membership (what lets it write) and then its registration.

**The relay.** A website needs a node that relays for the namespace:

- Make the namespace always-on in Calimero Desktop and Calimero Cloud's nodes
  relay for it.
- Or use a node of the team's own. An admin grants it `CAN_AUTHOR_ON_BEHALF`
  from the Connect tab ("Let this node write for form keys"), its operator runs
  it with `merod … init --delegated-access` (which serves the warrant route
  without a node credential), and the site's `CALIMERO_RELAY_URL` points at it.

calimero.network's contact page is wired this way: see "Contact form" in the
[landing README](https://github.com/calimero-network/landing).

## Public links

A public link is a form key carried in the link itself:
`https://mero-forms.vercel.app/f#<key>`. An admin makes one from the form's
**Connect** tab ("Share a public link"), the same four steps as a website key,
and the app shows the link once. Anyone who opens it gets the form alone, with
no sign-in and no node (`app/src/PublicForm.tsx`): the page reads the questions
with `get_form` and sends the answers with `submit_response`, both signed in
the visitor's browser and run by the relay as the key's account.

The key sits after the `#`. A browser never sends the fragment to the server
it loads the page from and never puts it in a `Referer`, so the host serving
the page (Vercel) never sees it; only the relay sees the signed requests. The
key is not secret from whoever has the link, and is not meant to be: it can
answer this one form and nothing else, exactly like a website's key, and it
reads nothing (`app/src/lib/formKey.ts` says why).

What a link cannot do that a website's backend can:

- **Rate-limit or filter.** Whoever has the link can send as many responses as
  they like. Share it where you would share any form; revoke it in **Keys for
  this form** to stop it, and make a new one.
- **Keep one nonce counter.** Every visitor signs with the same device, and the
  relay keeps one 64-wide replay window per author device. So the page takes
  its nonces from the clock (`clockNonces` in `app/src/lib/publicLink.ts`), and
  a send refused as a replay, which happens when a visitor whose clock runs
  ahead sent moments earlier, is retried further ahead, up to the five minutes
  a warrant lives. Someone holding the link can also sign a nonce far in the
  future on purpose and stop the link working for everyone; revoking it and
  making a new one is the fix.

The relay the link names is chosen when it is made: for a Calimero Cloud
sign-in, the relay serving the workspace; for a node, the node itself, which
works only if it relays (`--delegated-access` and "Let this node write for form
keys") and visitors can reach it at that address. The admin can change it
before making the link.

## Sending to Mero CRM

The hand-off runs in the browser of the teammate who clicks it
(`app/src/useCrm.ts`), against the pipeline's own context, as that person. So
they have to be a member of the pipeline, which lives in its own namespace:
join it from Mero CRM's invite link. Keep it out of the forms workspace's
namespace: Mero CRM lets every member write deals and contacts, and website
form keys are members of the workspace's namespace.

How the pipeline is found and written to depends on how you signed in:

- **A node** (Calimero Desktop or `merod`): the Connect tab lists the Mero CRM
  pipelines this node has joined (by the `com.calimero.mero-crm` package among
  its installed apps), and the hand-off writes through the node as its
  identity in the pipeline.
- **A Calimero Cloud account**: the Connect tab asks every Cloud relay the
  account knows for its contexts (`listDelegatedContexts`) and keeps the Mero
  CRM ones, matched by the application id the registry gives for that package.
  The hand-off writes through the relay that serves the pipeline, under the
  account's warrant, which may be a different relay from the one the workspace
  is on. Mero CRM stamps who created each record in an entry only that account
  owns, and core lets a relay sign such an entry on someone's behalf only when
  it is an attested TEE relay (a `RelayTee`). Calimero Cloud's relays are; a
  team's own node relaying for an account is not, and the error says so.

When the list cannot be fetched (the registry or a relay is down), paste the
pipeline's id into the Connect tab: it is tried directly.

One send is: reuse the CRM contact with the same email or create one, create a
deal in the chosen stage, add a note with every answer, then
`record_crm_deal` here so the response reads "In CRM" for the whole team. Two
apps' contexts share no transaction, so it is not atomic: if the last steps
fail the deal exists and the error says so, and sending again makes a second
deal. `record_crm_deal` refuses a response this node already knows was sent;
two teammates sending the same response at the same moment from two nodes can
still both create a deal.

The link (pipeline, stage, field mapping) is stored on the form, so the whole
team sends to the same place.

## The contract in one table

| State | Tier | Why |
| --- | --- | --- |
| `responses: UnorderedMap<id, LwwRegister<Response>>` | public, insert-only | The answers as sent, with each question's label at the time, `source`, `created_at` and `submitted_by`. `submit_response` refuses an existing id and nothing else writes it. |
| `forms: SharedStorage<UnorderedMap<id, Form>>` | writers = the team | Title, description, questions, open, CRM link. Each part a register; the question list is replaced whole on save. |
| `triage: SharedStorage<UnorderedMap<id, ResponseState>>` | writers = the team | Archived, and the CRM deal a response became. |
| `settings: SharedStorage<UnorderedMap<key, LwwRegister<String>>>` | writers = the team | The workspace's name. |
| `form_keys: SharedStorage<UnorderedMap<account, FormKey>>` | writers = the admins | Which members are form keys, the form each may answer, and a label. The register, not the grant: membership is the grant. |
| `roles: AccessControl` | admins | The admins (the installer to start with) and the `team` role. Adding or removing a teammate rotates the writers of `forms`, `triage` and `settings`. |

**Why responses are not owned storage.** `WriteOnce` would make a response
immutable for every node, but core lets only an attested TEE relay
(`RelayTee`) sign an owned entry on a member's behalf. Owned responses would
make every website response depend on Calimero Cloud's fleet, and a team's own
node could never relay one. So insert-only is enforced by the contract, which
binds honest nodes: a patched *member* node could overwrite a response. Every
member node already holds every response, so that is a member misbehaving
inside the boundary, not a way in.

**A form changes; its responses don't.** Each stored answer carries its
question's id, label and kind, so a response still reads correctly after a
question is renamed or removed (the panel marks it "no longer on the form", and
the CSV keeps it as a column). A form with responses can be closed but not
deleted.

Events carry ids only, never answers.

### Methods

| Method | Who | Does |
| --- | --- | --- |
| `create_form(title, description)` / `update_form(form_id, title, description, fields)` | team | Make a form, replace its questions |
| `set_form_open(form_id, open)` / `delete_form(form_id)` | team | Close or reopen; delete one with no responses |
| `set_crm_link(form_id, link)` | team | Where its responses go in Mero CRM |
| `get_form(form_id)` | any member | One form, so a website may read what it answers |
| `list_forms()` / `field_kinds()` | team / anyone | Forms with response counts; the kinds of question |
| `submit_response(form_id, answers, source)` | any member | Store a checked response; returns its id |
| `list_responses(form_id)` / `get_response(id)` | team | Responses, newest first |
| `set_archived(id, archived)` / `record_crm_deal(id, crm_context, crm_deal)` | team | Archive; mark sent to the CRM |
| `list_team()` / `add_team_member(who)` / `remove_team_member(who)` | team / admin | The team |
| `workspace_name()` / `set_workspace_name(name)` | anyone / team | The workspace's name |
| `register_form_key(account, form_id, label)` / `forget_form_key(account)` / `list_form_keys()` | admin | The form key register, with each key's response count |
| `am_i_team()` / `am_i_admin()` / `my_account()` | anyone | Identity |

## Run it

```bash
cargo test -p mero-forms                           # contract tests, no node
cargo mero bundle --manifest-path apps/mero-forms/logic/Cargo.toml \
  --dev --app-version 0.0.0 \
  --output apps/mero-forms/logic/dist/com.calimero.mero-forms.mpk
apps/mero-forms/logic/build-multi-service-bundle.sh   # the Mero CRM bundle the journey uses
pnpm -F mero-forms codegen                         # both ABIs -> src/generated
pnpm -F mero-forms dev                             # http://localhost:5198

pnpm -F mero-forms test                            # unit tests
pnpm -F mero-forms test:e2e                        # Playwright against a real merod
cd apps/mero-forms/logic && merobox bootstrap run workflows/e2e.yml   # two nodes
```

The Playwright journey is the whole product path on one node, with a real Mero
CRM pipeline beside it: build a form from a template and add a question, enter
a response by hand, issue a form key, answer as a website through
`RelayClient`, make a public link and answer it as a visitor with no session,
read the summary and the response, link the pipeline, send the response, check
the contact and deal in Mero CRM's own state, reload, and revoke both keys.

`codegen` generates two clients: `FormsClient` from this contract, and
`CrmClient` from `apps/mero-crm/logic/res/abi.json` for the hand-off.

## Layout

```
logic/src/lib.rs            the contract
logic/src/tests.rs          TestHost tests: questions, answers, keys, the team, writers
logic/workflows/e2e.yml     merobox: two nodes, every method, the access rules
logic/build-multi-service-bundle.sh   builds the Mero CRM fixture (CI's hook)
app/src/FormsHome.tsx       templates and the form list
app/src/FormView.tsx        one form: Responses, Edit, Preview, Connect
app/src/FormBuilder.tsx     the question editor
app/src/FormFill.tsx        the form as a respondent sees it
app/src/Responses.tsx       summary, table, one response, Send to CRM
app/src/FormConnect.tsx     form keys, public links and the relay
app/src/PublicForm.tsx      the form opened from a public link (`/f#…`)
app/src/CrmSettings.tsx     the CRM pipeline, stage and field mapping
app/src/useCrm.ts           finding pipelines (node or Cloud account) and sending a response
app/src/lib/                pure, unit-tested: questions and answers, CRM mapping, form keys
app/src/useWorkspace.ts     the generated client + re-read on sync events
app/src/{ContextPicker,InviteCard,TeamCard,useJoinFromInvitation}.tsx, utils/
                            login, workspace selection, team and invites
app/e2e/                    Playwright against a native merod
```

The frontend is not deployed yet: `frontend` in `logic/Cargo.toml` names
`https://mero-forms.vercel.app`, which needs a Vercel project with Root
Directory `apps/mero-forms/app` (see [docs/VERCEL.md](../../docs/VERCEL.md)).
