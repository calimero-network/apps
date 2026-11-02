# Mero Forms

Forms with the questions you choose, the responses they collect, and a one-click
hand-off of any response to [Mero CRM](../mero-crm). A **component app** on
Calimero 1.0: the contract runs on core's component SDK (`calimero-app-sdk`
1.0.0-rc.8, `wasm32-wasip2`), the frontend talks to the cluster through mero-js
`CalimeroClient` (`@calimero-apps/connect`), and local development runs on
`merod local`. See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).

A workspace of forms is one **app instance** in an **organization**. The
contract keeps its own **team** inside it (the admins, starting with the
instance's owner, and the organization members they add), and only the team
builds forms and reads responses.

What using it looks like:

- **Build a form** from a template (Contact us, Request a demo, Feedback) or
  from scratch. Nine kinds of question: short answer, paragraph, email, phone,
  number, website, date, multiple choice and checkboxes. Each can be required
  and carry help text; questions reorder, duplicate and delete. Close a form to
  stop new responses.
- **Collect responses** three ways: a public link anyone can open and answer
  without signing in, a website's backend answering with a form key, or a
  member entering one by hand from **Preview**. The contract checks every
  answer against its question, so a stale or tampered website fails loudly
  instead of storing junk.
- **Read them**: a summary of every choice question, a searchable table
  (New, All, In CRM, Archived), one response in full, CSV export.
- **Send to CRM**: link a form to a Mero CRM pipeline once, map which question
  is the contact's name, email, phone and organization, then send a response
  (or all new ones). Each becomes a contact (reused when the email matches), a
  deal in the stage you chose, and a note on the deal with every answer.
- **A team**: admins add members of the organization to the team, or remove
  them. Being in the organization is not being on the team: a member who is
  not on it sees "Waiting to be added to the team". Guests of the
  organization cannot join the team.

## What the operator configures

| Where | What | Why |
| --- | --- | --- |
| The node's outbound HTTP | allow `challenges.cloudflare.com` | a form whose captcha the workspace checks (`turnstile`) calls Cloudflare's `siteverify` from the contract |
| The node's secrets, for `com.calimero.mero-forms` | `TURNSTILE_SECRET`: the secret of a Cloudflare Turnstile widget | the contract names it as `{{secret:TURNSTILE_SECRET}}`; the node fills it in and the app never sees it |
| The workspace (its owner, once per release) | approve the manifest's `outbound` prefix `https://challenges.cloudflare.com/turnstile/v0/` | without it the check is refused, and so is every response that needs it |
| The workspace (its owner) | access `public` (Connect → Public links → "Open the workspace to public links") | anonymous visitors of a public link reach the cluster only on a public instance |
| The node's allowed origins (`origins`) | the origin public links open on, when it is not the bundle's own (e.g. `https://mero-forms.vercel.app`) | a bundle-served page's CSP allows scripts and frames from its own origin only, so Cloudflare's Turnstile widget cannot load there; a captcha'd public form is served from another origin, which the node must allow (CORS) |
| The frontend build | `VITE_PUBLIC_FORM_ORIGIN` (where links open), `VITE_TURNSTILE_SITE_KEY` (the widget's public site key, unless an admin sets the team's own in Team → Captcha) | see `app/.env.example` |
| The Vercel project (optional) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CAPTCHA_SIGNING_SEED` | only for the verifier captcha (`app/api/captcha.ts`), the alternative to the workspace checking Turnstile itself |

Mero CRM needs nothing from the operator: the hand-off is a cross-app call
inside one organization.

## Form keys

A form key is a core **API key** of an admin's account, limited to this
workspace and to two methods, `submitResponse` and `getForm`. An admin issues
one from the form's **Connect** tab:

1. the admin's client creates the key (`createApiKey`, approved with the
   admin's passkey); the key's secret is shown once and kept nowhere else;
2. the app registers the key's id in the contract (`registerFormKey`), which
   binds it to this form, labels it and keeps it off the team.

The app then shows, once:

```
CALIMERO_APP_ID=…
CALIMERO_FORM_ID=…
CALIMERO_API_KEY=…
```

The website's backend calls the cluster with mero-js `CalimeroClient`
(`useApiKey(CALIMERO_API_KEY)`) and `submitResponse`:

```json
{
  "formId": "<CALIMERO_FORM_ID>",
  "answers": [
    { "fieldId": "name", "values": ["Ada Lovelace"] },
    { "fieldId": "email", "values": ["ada@example.com"] },
    { "fieldId": "topic", "values": ["Cloud"] }
  ],
  "source": "/contact/"
}
```

One answer per question, under the question's id (shown on each question in
**Edit**, and as a full example in **Connect**). A choice is one of its
options; checkboxes any of them. Inside the contract the caller is the key
(`Caller::ApiKey`), so the key answers its own form and nothing else: the node
refuses every other method, and the contract refuses another form and never
counts the key as the admin it belongs to. Revoking deletes the key
(`revokeApiKey`) and then its registration. A key lives at most a year (core's
limit); issue a new one before it ends.

## Public links

A public link lets anyone answer a form in their browser, signed in or not.
A teammate makes one from the form's **Connect** tab ("Public links"); the
visitor opens `…/f#a=<workspace>&t=<token>` and sees the form alone
(`app/src/PublicForm.tsx`).

**A link is a token.** Making one is one call: the teammate's browser draws 32
random bytes, records their SHA-256 in the contract (`createLink`, with the
form and a label), and puts the token itself only in the link's URL. A
visitor's browser calls the workspace's two `#[app::public]` methods,
`linkForm` (the questions) and `submitViaLink` (a response), with the token,
anonymously. The contract opens a link only by its token: the id the team's
list shows is not one. The fragment never reaches the server that serves the
page, so the token reaches only the cluster.

**Anonymous callers need a public workspace.** The cluster lets an anonymous
caller reach an instance only when its access is `public`, and only its
`public` methods. Only the instance's owner can change access, so Connect →
Public links offers the owner "Open the workspace to public links" (and tells
anyone else to ask the owner). On a public instance every signed-in account
reaches the instance too, so every method that is not `public` checks the
caller itself: an account (or API key) with a role in the workspace's
organization, or the team, or an admin. Events go to the organization's
members only (`Audience::Org`), never to everyone.

**What the team controls, enforced by the contract:**

- **Public.** Off by default. While off, every link shows the form but
  refuses responses; turning it back on brings them all back.
- **An hourly cap per link** (30 by default), counted per clock hour. Over it,
  the link is refused until the hour rolls over.
- **A captcha**, optional, one of two kinds:
  - **Checked by the workspace** (`setCaptchaKey(form, "turnstile")`). The page
    shows Cloudflare's Turnstile widget (with the team's site key, else the
    deployment's `VITE_TURNSTILE_SITE_KEY`) and sends the widget's token as
    `submitViaLink`'s `captchaToken`. The contract sends it to
    `https://challenges.cloudflare.com/turnstile/v0/siteverify` from that same
    call (`env::fetch`), with the secret named as `{{secret:TURNSTILE_SECRET}}`.
    It stores the response only when Cloudflare answers `success: true`: a
    refused gate, an unreachable Cloudflare, an unreadable or negative answer
    all refuse it, never pass it. The token is checked last, after the form,
    the link, the cap and every answer, so a refused response spends none, and
    the node records the exchange in the call's log entry, so a retry replays
    it and never spends a token twice. Needs the operator's three settings
    above.
  - **Through a verifier** (`setCaptchaKey(form, <ed25519 key>)`), as before:
    the app's own Vercel function (`app/api/captcha.ts`,
    `app/src/lib/captchaVerifier.ts`) checks the solved widget with Cloudflare
    and signs a pass, `mero-forms/captcha/v1|<form>|<link id>|<nonce>|<expiry>`,
    which the contract checks itself and accepts once, until it expires (at
    most ten minutes ahead).
- **Deleting a link** removes its record, which stops it at once.

The node does not yet enforce a `rate` on public methods, so the hourly cap
per link is the limit; a rate limit per IP belongs to the node's reverse proxy.

## Sending to Mero CRM

Send to CRM is one call to this workspace, `sendToCrm(id)` (team only), which
hands the response to the form's Mero CRM pipeline **from the contract**: a
synchronous cross-app call (`env::xcall_call`) to the pipeline's instance, then
the deal it answers is recorded here in the same call, so the response reads
"In CRM" for the whole team. The browser writes nothing to the CRM.

- **Same organization.** Cross-app calls stay inside one organization, so the
  pipeline must be a Mero CRM instance in the workspace's organization. The
  Connect tab lists the Mero CRM instances your account reaches (by the
  `com.calimero.mero-crm` package) and their stages; a pipeline's instance id
  can be pasted there too (instances made from a dev bundle carry no package).
- **Once.** A response already sent is refused before Mero CRM is asked;
  two teammates sending at once are ordered by the log, so the second is
  refused. When Mero CRM refuses, nothing is recorded and the error says why.
- **Not atomic across apps.** Mero CRM commits its call before this one
  records the deal; if this call failed after that (it only writes a few
  rows), the deal would exist unrecorded. `externalRef` lets Mero CRM refuse a
  second import of the same response.
- `recordCrmDeal(id, crmContext, crmDeal)` stays, to record a deal made by
  hand.

**The method Mero CRM provides.** The forms contract calls `importFormResponse`
on the pipeline's instance. Mero CRM is being ported to the component SDK in
its own PR; this is the contract between the two (`CRM_IMPORT`, `CrmImport`,
`CrmImported` in `logic/src/lib.rs`), taken from v1's browser hand-off
(`listContacts` + `createContact` + `createDeal` + `addNote`, which it does in
one call):

```rust
/// One form response: reuse the contact with this email (or create one), a
/// deal in `stageId` for them, and a note on the deal. For apps of the
/// organization (Mero Forms), in one call of their own.
#[app::allow(app = "*")]
pub fn import_form_response(
    &mut self,
    stage_id: String,
    contact: Contact,     // { name, email, phone, organization, jobTitle }
    deal: Deal,           // { title, organization, source }
    note: String,         // every answer, at most 10,000 characters
    external_ref: String, // "mero-forms:<forms app id>:<response id>"
) -> app::Result<Imported> // { contactId, dealId }
```

The values are clipped to Mero CRM's limits (names and titles 120 characters,
the note 10,000) as v1's `crmPayload` did; `email` is empty when the form maps
none (then a new contact is always created). The answer needs `dealId`;
`contactId` is optional. `allow(app = "*")` is safe because the node only
lets apps of the same organization make the call, and `env::caller()` is
`Caller::App(<forms app id>)` inside it. Until Mero CRM ships the method, the
hand-off answers "Mero CRM refused the hand-off: …" and records nothing.

## The contract

| State | What it holds |
| --- | --- |
| `forms: UnorderedMap<id, FormRow>` | Title, description, questions (at most 50, replaced whole on save), open, CRM link, public, the hourly cap, the captcha key. At most 200 forms |
| `submissions: Table<Submission>` | Every response: form, `source`, `createdAt`, `submittedBy`, the link it came through. Indexed by `(formId, createdAt)`, read one page at a time. Inserted once; nothing writes it again |
| `answers: UnorderedMap<responseId, Vec<Answer>>` | A response's answers (one per question the form had, at most 50), each with its question's id, label and kind at the time. Beside the record because a table record holds no list |
| `formStats`, `linkStats`, `senderStats` | Counts kept with each write (responses, new ones, the last one, this hour's), so no read scans the responses |
| `triage: UnorderedMap<id, ResponseState>` | Archived, and the CRM deal a response became |
| `settings: UnorderedMap<key, String>` | The workspace's name, the Turnstile site key |
| `formKeys: UnorderedMap<apiKeyId, FormKey>` | Which API keys are form keys, the form each may answer, and a label. At most 200 |
| `links`, `formLinks` | Each public link by the SHA-256 of its token, and a form's links (at most 100 per form) |
| `captchaSeen`, `captchaExpiry` | Verifier passes already spent, until they expire |
| `admins: Set<account>`, `team: Set<account>` | The admins (the instance's owner) and the rest of the team (at most 1,000) |

A form changes; its responses don't. A form with responses can be closed but
not deleted. Events carry ids only, never answers, and go to the
organization's members. Errors are `Invalid`, `NotFound`, `Forbidden`,
`Refused` and `Unsupported`, each with v1's message.

### Methods

| Method | Who | Does |
| --- | --- | --- |
| `createForm(title, description)` / `updateForm(formId, title, description, fields)` | team | Make a form, replace its questions |
| `setFormOpen(formId, open)` / `deleteForm(formId)` | team | Close or reopen; delete one with no responses |
| `setCrmLink(formId, link)` | team | Where its responses go in Mero CRM (`link.contextId` is the pipeline's instance id) |
| `getForm(formId)` | anyone in the organization, a form key | One form, so a website may read what it answers |
| `listForms()` / `fieldKinds()` | team / anyone signed in | Forms with response counts; the kinds of question |
| `submitResponse(formId, answers, source)` | anyone in the organization, a form key | Store a checked response; returns its id |
| `listResponses(formId, cursor, limit)` / `getResponse(id)` | team | One page of responses, newest first (`{ items, next }`, 100 by default, at most 1,000); one response |
| `setArchived(id, archived)` | team | Archive, or bring back |
| `sendToCrm(id)` / `recordCrmDeal(id, crmContext, crmDeal)` | team | Hand a response to Mero CRM and record the deal; record one made by hand |
| `listTeam()` / `addTeamMember(who)` / `removeTeamMember(who)` | team / admin | The team |
| `workspaceName()` / `setWorkspaceName(name)` | anyone in the organization / team | The workspace's name |
| `registerFormKey(account, formId, label)` / `forgetFormKey(account)` / `listFormKeys()` | admin | The form key register (`account` is the API key's id), with each key's response count |
| `setFormPublic(formId, public)` / `setLinkCap(formId, perHour)` / `setCaptchaKey(formId, key)` | team | Whether links take responses, how many per hour, and the captcha: `turnstile`, a verifier's key, or empty |
| `createLink(formId, link, label)` / `deleteLink(link)` / `listLinks(formId)` | team | The public link register (`link` is the SHA-256 of the token), with each link's counts |
| `linkForm(link)` / `submitViaLink(link, answers, captcha, captchaToken)` | anyone, signed in or not (`#[app::public]`) | The two calls a public link makes, with the token as `link` |
| `setCaptchaSiteKey(siteKey)` / `setCaptchaSecret(siteKey, secret)` / `clearCaptchaSecret()` / `captchaSettings()` | admin / admin / admin / team | The Turnstile site key public pages show; a team-held secret is refused (see below) |
| `amITeam()` / `amIAdmin()` / `myAccount()` | anyone signed in | Identity |

## What changed in the port

Every change a client sees, v1 → here.

| | v1 (calimero-sdk 0.12, merobox, mero-react) | here (component SDK 1.0.0-rc.8, CalimeroClient) |
| --- | --- | --- |
| Names on the wire | `create_form`, `form_id`, snake_case records | `createForm`, `formId`, camelCase records; 64-bit numbers are decimal strings |
| Timestamps | nanoseconds | milliseconds (the log's clock) |
| A workspace | a context in a namespace | an app instance in an organization |
| Joining | a namespace invitation link | an organization invite (`?invite=<token>&workspace=<app>`), approved with the inviter's passkey, redeemed after sign-in |
| The team | `AccessControl` + `SharedStorage` writer sets, enforced by every node | `admins` / `team` sets, checked by each method against `env::caller()`; a seat ends when its holder leaves the organization |
| Joining the team | any namespace member | a member (or admin) of the organization; guests are refused |
| Who reads responses | every member node held them; `list_responses` only refused | only the team: the cluster runs the contract, and no method answers them to anyone else |
| Reaching the workspace | namespace membership | the organization's role, checked by the contract (the instance may be public for links) |
| Events | to every member node | to the organization's members, admins and owner (`Audience::Org`), never guests or anonymous visitors |
| Form key | an account with a certified device and no node, joined to the namespace, writing through a relay by delegated execution | an API key of an admin's account, scoped to `submitResponse` and `getForm`, bound to the form by its id; no relay, no warrant, no namespace membership |
| `submittedBy` | the form key's account, or the node that held a link's grant | the form key's id, the account, or `public` for an anonymous visitor of a link (the account, for a signed-in one) |
| Public link | a node access grant (`/grant-calls`) on a teammate's node, which visitors' browsers had to reach; `link` was the SHA-256 of the grant's token | a random token; the contract keeps its SHA-256 and the two link methods are `#[app::public]`. `linkForm` and `submitViaLink` take the **token** as `link`; `createLink` takes its SHA-256 and no `grantId`; `LinkView` has no `grantId` |
| Anonymous visitors | through the node's grant route | through a public instance (its owner opens it); no node needs to be public, and no passkey makes a link |
| Hourly cap | a sliding hour, by scanning the responses | the clock hour, from stored counts |
| Captcha: `turnstile` | the contract asked Cloudflare through the node (`env::http_request`, `{{secret:TURNSTILE_SECRET_KEY}}`) | the contract asks Cloudflare from the call (`env::fetch`, D76), the secret named `{{secret:TURNSTILE_SECRET}}`; refused on any failure; checked after the answers, so a wrong answer spends no token |
| Captcha: the team's own secret | sealed to the namespace's TEE (`env::seal_outbound_secret`) | **not supported** (no TEE methods or sealed secrets in rc.8): `setCaptchaSecret` answers `Unsupported`, `captchaSettings` says no TEE; the team sets its public site key (`setCaptchaSiteKey`, new) and the operator holds the secret |
| Captcha: verifier pass | checked with the host's `ed25519_verify` | checked in the contract (ed25519-dalek); `<link>` in the signed message is the link's id |
| Responses | one map, every entry per read | a table indexed by form, `listResponses` answers one page (`{ items, next }`, new `cursor` and `limit` arguments); the frontend follows `next` |
| Other lists | every entry | bounded: forms 200, links 100 per form, form keys 200, team 1,000 |
| Send to CRM | the teammate's browser wrote a contact, a deal and a note to the pipeline, then `record_crm_deal`; not atomic, a refusal after the deal left it unrecorded | `sendToCrm(id)` (new): the contract hands the response to Mero CRM's `importFormResponse` in one cross-app call and records the deal in the same call; the pipeline must be in the workspace's organization |
| Errors | strings | `Invalid` / `NotFound` / `Forbidden` / `Refused` / `Unsupported` with v1's message |
| Sign-in | node login, Calimero Cloud account, desktop SSO | a passkey (sign in or sign up) |
| Tests | `TestHost` + merobox two-node workflow + Playwright journey | `TestApp` harness (`tests/harness.rs`) + `scenarios/*.json` in the harness and on `merod local` |

**Removed:** `logic/workflows/e2e.yml` (merobox), `logic/src/tests.rs`
(`TestHost`), `logic/res/state-schema.json`,
`logic/build-multi-service-bundle.sh` (the Mero CRM fixture the journey
used), `app/src/generated/` (abi-codegen clients), the Playwright journey
against merod (`app/e2e/forms.spec.ts`, its setup and helpers), the namespace
invitation, desktop SSO and context picker code, and mero-react,
mero-platform, abi-codegen and e2e-node.

**Not ported, and why:** a team-held Turnstile secret (needs TEE methods and
sealed secrets, which the component SDK at 1.0.0-rc.8 does not have; the
operator's secret replaces it). v1 Mero Forms has no migrations, event
handlers, private storage or CRDTs beyond plain records, so nothing else is
missing. There is no mobile app.

## Run it

```bash
rustup target add wasm32-wasip2
cargo test --manifest-path apps/mero-forms/logic/Cargo.toml        # harness + scenarios
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- build apps/mero-forms/logic

pnpm dev:local mero-forms        # merod local + deploy + the app on http://localhost:5173
pnpm merod-local e2e mero-forms  # the scenarios as real accounts on the cluster

pnpm -F mero-forms lint typecheck test build
```

`merod local` runs on Linux (core's release binary). On `merod local` the
Turnstile check needs the node's outbound settings and secret too; without
them a `turnstile` form refuses every link response, as it should. The
production build needs `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE`
(see `app/.env.example`); the production frontend is the one packed into the
bundle (`frontend-dir`).

## Layout

```
logic/src/lib.rs            the contract
logic/tests/harness.rs      TestApp tests: every method, keys, links, captchas (Turnstile through mock_http), the CRM hand-off (mock_app), access
logic/scenarios/            neutral steps: run by cargo test and on merod local
app/src/formsApi.ts         the typed adapter: v1's method names and shapes over CalimeroClient
app/src/crmApi.ts           the Mero CRM stages the Connect tab lists
app/src/FormsHome.tsx       templates and the form list
app/src/FormView.tsx        one form: Responses, Edit, Preview, Connect
app/src/FormBuilder.tsx     the question editor
app/src/FormFill.tsx        the form as a respondent sees it
app/src/Responses.tsx       summary, table, one response, Send to CRM
app/src/FormConnect.tsx     form keys
app/src/PublicLinks.tsx     public links: Public, the cap, the captcha, the workspace's access, make and delete
app/src/PublicForm.tsx      the form opened from a public link (`/f#…`), anonymously
app/src/CaptchaCard.tsx     the team's Turnstile site key
app/api/captcha.ts          the captcha verifier (a Vercel function)
app/src/CrmSettings.tsx     the CRM pipeline, stage and field mapping
app/src/useCrm.ts           finding pipelines and sending a response (`sendToCrm`)
app/src/lib/                pure, unit-tested: questions and answers, links, orgs
app/src/session.ts          target -> client -> passkey sign-in/up (SessionStore)
app/src/WorkspacePicker.tsx workspaces (app instances) in your organizations
app/src/SignIn.tsx          the passkey sign-in and the invitation prompt
```
