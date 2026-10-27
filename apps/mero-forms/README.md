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
  without signing in (below), a website's backend answering with a form key,
  or a teammate entering one by hand from **Preview**. The contract checks
  every answer against its question, so a stale or tampered website fails
  loudly instead of storing junk.
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

A form key is a Calimero Cloud API key that may call exactly `submit_response`
on the workspace's app, and nothing else: it cannot read responses or change a
form. An admin issues one from the form's **Connect** tab
(`app/src/FormConnect.tsx`, `app/src/lib/formKey.ts`), and the app shows, once:

```
CALIMERO_URL=…
CALIMERO_APP_ID=…
CALIMERO_FORM_ID=…
CALIMERO_API_KEY=…
```

The website's backend sends each response with `CalimeroClient` from
`@calimero-network/mero-js` (`useApiKey(CALIMERO_API_KEY)`, then
`call(CALIMERO_APP_ID, "submit_response", { form_id, answers, source })`).
Revoking the key on the Connect tab makes the cluster refuse it.

A response a key sends is recorded as the admin who issued it: Calimero Cloud
has no keys with an identity of their own yet. (v1's form keys were accounts
of their own, written through a relay with delegated-execution warrants; the
contract's `register_form_key` registry is unused on Calimero Cloud.)

## Public links

A public link lets anyone answer a form in their browser, signed in or not,
like a Google Form. A teammate makes one from the form's **Connect** tab
("Public links"); the visitor opens `https://mero-forms.vercel.app/f#n=…&c=…&t=…`
and sees the form alone (`app/src/PublicForm.tsx`).

**A link is a core access grant, not a member's key.** Making one does two
things, as Mero Calendar's booking links do (`app/src/PublicLinks.tsx`):

1. the teammate's node issues an access grant
   (`POST /admin-api/contexts/:id/grants`) that names `link_form` and
   `submit_via_link` and nothing else;
2. the contract records the link under the SHA-256 of the grant's token
   (`create_link`), with the form it is for and a label.

The URL's fragment carries the node, the workspace and the token. A browser
never sends the fragment to the server that serves the page, so the token
reaches only the node, on its public `/grant-calls` route. The visitor is a
member of nothing: no account, no key that could ever receive the workspace's
data, and no call but those two. A grant call runs as the node that issued it,
a teammate, so those two methods are the link's own: `submit_via_link` takes a
response only through a link the contract knows, and the visitor never reaches
`submit_response` or anything that reads responses.

**What the team controls, enforced by the contract:**

- **Public.** Off by default. While off, every link shows the form but
  refuses responses; turning it back on brings them all back.
- **An hourly cap per link** (30 by default), counted from the link's own
  responses. Over it, the link is refused until the hour rolls over.
- **A captcha**, optional. The contract makes no network calls, so it cannot
  ask Cloudflare itself. The `/f` page shows a Cloudflare Turnstile widget,
  and the app's own Vercel function (`app/api/captcha.ts`,
  `app/src/lib/captchaVerifier.ts`) checks the solved widget with Cloudflare.
  It then signs a pass, `mero-forms/captcha/v1|<form>|<link>|<nonce>|<expiry>`,
  with an ed25519 key. The contract checks that signature with the host's
  `ed25519_verify` against the key the form saved, and accepts each nonce once
  and only until it expires (at most ten minutes ahead). The function sees the
  form, the link and a random nonce, never the answers, and holds no key or
  grant.
- **Deleting a link** removes its record, which stops it at once, and revokes
  its grant when the link was made on this node. A link made on a teammate's
  node keeps a grant there that reaches nothing, until they remove it.

**What a link needs:**

- **Core 0.11.0 or later on the teammate's node.** Access grants are not in
  0.11.0-rc.90.
- **A node signed in, not a Calimero Cloud account session.** Core runs a
  granted call as the node, so an account session cannot issue one.
- **A node visitors' browsers can reach**, at the URL the app is connected
  to, with CORS allowing the app's origin: a Calimero Cloud node, or your own
  `merod` at a public address. Calimero Desktop on a laptop is not.
- **For the captcha, three variables on the Vercel project:**
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from a Cloudflare Turnstile
  widget, and `CAPTCHA_SIGNING_SEED`, 32 random bytes in hex
  (`openssl rand -hex 32`). Changing the seed changes the key, so re-enable
  "Require a captcha" on each form that uses it.

A grant limits *which* methods may be called, not their arguments, and
nothing in core limits how often the node's `/grant-calls` route is called:
the hourly cap is the contract's, and a rate limit per IP belongs to the
node's reverse proxy.

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
| `responses: UnorderedMap<id, LwwRegister<Response>>` | public, insert-only | The answers as sent, with each question's label at the time, `source`, `created_at`, `submitted_by` and the public link it came through. `submit_response` and `submit_via_link` refuse an existing id and nothing else writes it. |
| `forms: SharedStorage<UnorderedMap<id, Form>>` | writers = the team | Title, description, questions, open, CRM link, and for public links: public, the hourly cap, the captcha key. Each part a register; the question list is replaced whole on save. |
| `triage: SharedStorage<UnorderedMap<id, ResponseState>>` | writers = the team | Archived, and the CRM deal a response became. |
| `settings: SharedStorage<UnorderedMap<key, LwwRegister<String>>>` | writers = the team | The workspace's name. |
| `form_keys: SharedStorage<UnorderedMap<account, FormKey>>` | writers = the admins | Which members are form keys, the form each may answer, and a label. The register, not the grant: membership is the grant. |
| `links: SharedStorage<UnorderedMap<sha256(token), Link>>` | writers = the team | Each public link: its form, label, access grant id and the teammate whose node holds the grant. Deleting the row stops the link. |
| `captcha_seen: SharedStorage<UnorderedMap<nonce, expiry>>` | writers = the team | Captcha passes already spent, until they expire. |
| `roles: AccessControl` | admins | The admins (the installer to start with) and the `team` role. Adding or removing a teammate rotates the writers of `forms`, `triage`, `settings`, `links` and `captcha_seen`. |

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
| `set_form_public(form_id, public)` / `set_link_cap(form_id, per_hour)` / `set_captcha_key(form_id, key)` | team | Whether links take responses, how many per hour, and the captcha verifier's key (empty for none) |
| `create_link(form_id, link, grant_id, label)` / `delete_link(link)` / `list_links(form_id)` | team | The public link register, with each link's response counts |
| `link_form(link)` / `submit_via_link(link, answers, captcha)` | a link's grant | The two calls a public link may make: the questions, and a response |
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
`RelayClient`, make a public link and answer it as a visitor with no session
(paused until the form is public, through a stubbed captcha whose pass the
contract really verifies, and refused over the hourly cap), read the summary
and the response, link the pipeline, send the response, check the contact and
deal in Mero CRM's own state, reload, delete the link and revoke the key. The
link steps need a merod with access grants (core 0.11.0).

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
app/src/FormConnect.tsx     form keys and the relay
app/src/PublicLinks.tsx     public links: Public, the cap, the captcha, make and delete
app/src/PublicForm.tsx      the form opened from a public link (`/f#…`)
app/api/captcha.ts          the captcha verifier (a Vercel function)
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
