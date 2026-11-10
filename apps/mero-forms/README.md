# Mero Forms

Forms with the questions you choose, the responses they collect, and a one-click
hand-off of any response to [Mero CRM](../mero-crm). A **component app** on
Calimero 1.0: the contract runs on core's component SDK (`calimero-sdk`,
`wasm32-wasip2`), the frontend talks to the cluster through mero-js
`CalimeroClient` (`@calimero-apps/connect`), and local development runs on
`merod local`. See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).

A workspace of forms is one **app instance** in an **organization**. Everyone
the organization holds reaches the instance; the contract keeps its own
**team** inside it, and only the team builds forms and reads responses.

What using it looks like:

- **Build a form** from a template (Contact us, Request a demo, Feedback) or
  from scratch. Nine kinds of question: short answer, paragraph, email, phone,
  number, website, date, multiple choice and checkboxes. Each can be required
  and carry help text; questions reorder, duplicate and delete. Close a form to
  stop new responses.
- **Collect responses** three ways: a public link anyone can open and answer
  without signing in, a website's backend answering with a form key, or a
  teammate entering one by hand from **Preview**. The contract checks every
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
  not on it sees "Waiting to be added to the team".

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

**A link is an API key, not a member's key.** Making one does two things, as
Mero Calendar's booking links do:

1. the teammate's client creates an API key of their account limited to this
   workspace and to `linkForm` and `submitViaLink` (a passkey step-up);
2. the contract records the link under the SHA-256 of the key (`createLink`),
   with the form it is for, the key's id and a label.

The URL's fragment carries the workspace and the token. A browser never sends
the fragment to the server that serves the page, so the token reaches only
the cluster. The contract opens a link only for its own key, so one link's
token cannot use another link, and a link's key is never the teammate it
belongs to.

**What the team controls, enforced by the contract:**

- **Public.** Off by default. While off, every link shows the form but
  refuses responses; turning it back on brings them all back.
- **An hourly cap per link** (30 by default), counted per clock hour. Over it,
  the link is refused until the hour rolls over.
- **A captcha**, optional: a pass from the app's verifier
  (`set_captcha_key(form, <ed25519 key>)`). The app's own Vercel function
  (`app/api/captcha.ts`, `app/src/lib/captchaVerifier.ts`) checks the solved
  Cloudflare Turnstile widget with Cloudflare and signs a pass,
  `mero-forms/captcha/v1|<form>|<link>|<nonce>|<expiry>`, with an ed25519
  key. The contract checks that signature itself and accepts each nonce once
  and only until it expires (at most ten minutes ahead). The function sees the
  form, the link and a random nonce, never the answers. It needs three
  variables on the Vercel project: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
  and `CAPTCHA_SIGNING_SEED` (32 random bytes in hex). A page the cluster
  serves from the bundle can only reach the cluster (its CSP), so a captcha
  needs the verifier reachable from where the public page runs.
- **Deleting a link** removes its record, which stops it at once, and revokes
  its API key when you made it. A link a teammate made keeps a key on their
  account that opens nothing, until they revoke it.

## Sending to Mero CRM

The hand-off runs in the browser of the teammate who clicks it
(`app/src/useCrm.ts`), against the pipeline's own app instance, as that
person, through the same `CalimeroClient`. So they have to reach the
pipeline: be a member of its organization (join from Mero CRM's invite link).
Keep it out of the forms workspace's organization if people who should not
see deals are in it.

The Connect tab lists the Mero CRM instances the account reaches (by the
`com.calimero.mero-crm` package). A pipeline's instance id can also be pasted
there; it is tried directly. Instances made from a dev bundle carry no
package, so on `merod local` paste the id.

One send is: reuse the CRM contact with the same email or create one, create a
deal in the chosen stage, add a note with every answer, then
`recordCrmDeal` here so the response reads "In CRM" for the whole team. Two
apps share no transaction, so it is not atomic: if the last steps fail the
deal exists and the error says so, and sending again makes a second deal.
`recordCrmDeal` refuses a response already sent; two teammates sending the
same response at the same moment can still both create a deal in the CRM, but
only the first is recorded here.

The hand-off speaks to Mero CRM's component contract (camelCase methods). A
pipeline still on the v1 runtime cannot be reached from a 1.0 client.

## The contract

| State | What it holds |
| --- | --- |
| `forms: UnorderedMap<id, FormRow>` | Title, description, questions (at most 50, replaced whole on save), open, CRM link, public, the hourly cap, the captcha key |
| `responses: UnorderedMap<id, Response>` | The answers as sent, with each question's label at the time, `source`, `createdAt`, `submittedBy` and the link it came through. Inserted once; nothing writes it again |
| `formResponses: Set<(form, createdAt, id)>` | A form's responses, read newest first |
| `formStats`, `linkStats`, `senderStats` | Counts kept with each write (responses, new ones, the last one, this hour's), so no read scans the responses |
| `triage: UnorderedMap<id, ResponseState>` | Archived, and the CRM deal a response became |
| `settings: UnorderedMap<key, String>` | The workspace's name |
| `formKeys: UnorderedMap<apiKeyId, FormKey>` | Which API keys are form keys, the form each may answer, and a label |
| `links`, `formLinks`, `linkKeys` | Each public link by the SHA-256 of its key, a form's links, and a link by its key's id |
| `captchaSeen`, `captchaExpiry` | Captcha passes already spent, until they expire |
| `admins: Set<account>`, `team: Set<account>` | The admins (the instance's owner) and the rest of the team |

A form changes; its responses don't. Each stored answer carries its question's
id, label and kind, so a response still reads correctly after a question is
renamed or removed. A form with responses can be closed but not deleted.
Events carry ids only, never answers. Errors are `Invalid`, `NotFound`,
`Forbidden`, `Refused` and `Unsupported`, each with v1's message.

### Methods

| Method | Who | Does |
| --- | --- | --- |
| `createForm(title, description)` / `updateForm(formId, title, description, fields)` | team | Make a form, replace its questions |
| `setFormOpen(formId, open)` / `deleteForm(formId)` | team | Close or reopen; delete one with no responses |
| `setCrmLink(formId, link)` | team | Where its responses go in Mero CRM |
| `getForm(formId)` | anyone in the org, a form key | One form, so a website may read what it answers |
| `listForms()` / `fieldKinds()` | team / anyone | Forms with response counts; the kinds of question |
| `submitResponse(formId, answers, source)` | anyone in the org, a form key | Store a checked response; returns its id |
| `listResponses(formId)` / `getResponse(id)` | team | Responses, newest first (at most 1,000) |
| `setArchived(id, archived)` / `recordCrmDeal(id, crmContext, crmDeal)` | team | Archive; mark sent to the CRM |
| `listTeam()` / `addTeamMember(who)` / `removeTeamMember(who)` | team / admin | The team |
| `workspaceName()` / `setWorkspaceName(name)` | anyone / team | The workspace's name |
| `registerFormKey(account, formId, label)` / `forgetFormKey(account)` / `listFormKeys()` | admin | The form key register (`account` is the API key's id), with each key's response count |
| `setFormPublic(formId, public)` / `setLinkCap(formId, perHour)` / `setCaptchaKey(formId, key)` | team | Whether links take responses, how many per hour, and the verifier's key (or empty) |
| `createLink(formId, link, grantId, label)` / `deleteLink(link)` / `listLinks(formId)` | team | The public link register, with each link's counts |
| `linkForm(link)` / `submitViaLink(link, answers, captcha, captchaToken)` | a link's key | The two calls a public link may make |
| `setCaptchaSecret(siteKey, secret)` / `clearCaptchaSecret()` / `captchaSettings()` | admin / admin / team | v1's team-held Turnstile keys: refused here (see below) |
| `amITeam()` / `amIAdmin()` / `myAccount()` | anyone | Identity |

## What changed in the port

| | v1 (calimero-sdk 0.12, merobox, mero-react) | here (component SDK 1.0.0-rc.7, CalimeroClient) |
| --- | --- | --- |
| Names on the wire | `create_form`, `form_id`, snake_case records | `createForm`, `formId`, camelCase records; 64-bit numbers are decimal strings |
| Timestamps | nanoseconds | milliseconds (the log's clock) |
| A workspace | a context in a namespace | an app instance in an organization |
| Joining | a namespace invitation link | an organization invite (`?invite=<token>&workspace=<app>`), approved with the inviter's passkey, redeemed after sign-in |
| The team | `AccessControl` + `SharedStorage` writer sets, enforced by every node | `admins` / `team` sets, checked by each method against `env::caller()` |
| Who reads responses | every member node held them; `list_responses` only refused | only the team: the cluster runs the contract, and no method answers them to anyone else |
| Form key | an account with a certified device and no node, joined to the namespace, writing through a relay by delegated execution | an API key of an admin's account, scoped to `submitResponse` and `getForm`, bound to the form by its id; no relay, no warrant, no namespace membership |
| `submittedBy` | the form key's account, or the node that held a link's grant | the form key's id, the account, or (through a link) the teammate whose key it is |
| Public link | a node access grant (`/grant-calls`) on a teammate's node, which visitors' browsers had to reach | an API key of the teammate's account; visitors reach the cluster. No node needs to be public, and a Cloud account can make one |
| A link's key | could call either link method for any link | opens only its own link |
| Hourly cap | a sliding hour, by scanning the responses | the clock hour, from stored counts |
| Captcha: verifier pass | checked with the host's `ed25519_verify` | checked in the contract (ed25519-dalek) |
| Captcha: `turnstile` (node asks Cloudflare) and team keys sealed to a TEE | `env::http_request`, `env::seal_outbound_secret` | **not supported**: the component SDK at 1.0.0-rc.7 has neither outbound HTTP nor sealed secrets (outbound HTTP lands in core after rc.7). `setCaptchaKey(…, "turnstile")` and `setCaptchaSecret` answer `Unsupported`; `captchaSettings` says no TEE is available; `captchaToken` is ignored |
| Lists | every entry | at most 1,000 per read (`listResponses`, `listLinks`, `listFormKeys`, `listTeam`) |
| Errors | strings | `Invalid` / `NotFound` / `Forbidden` / `Refused` / `Unsupported` with v1's message |
| CRM hand-off | node or Cloud relay transports, the registry's application id | the same `CalimeroClient`, Mero CRM instances by package, camelCase CRM methods |
| Sign-in | node login, Calimero Cloud account, desktop SSO | a passkey (sign in or sign up) |
| Tests | `TestHost` + merobox two-node workflow + Playwright journey | `TestApp` harness (`tests/harness.rs`) + `scenarios/*.json` in the harness and on `merod local` |


## Mero Forms's app team

An organization can hold several apps, each with its own **app team**
(core#4890; see Calimero Home's README). Mero Forms reaches its organization only
through `@calimero-apps/connect`'s org-app module
(`scripts/check-org-app-module.py` fails CI otherwise):

- A new organization made here gets Mero Forms's team at once, **open**
  (`standalone`: everyone in the org has the app). New workspaces use
  `{ kind: "team" }` access on it, invites name it (`appInvite`), and the
  people shown are its people (`appPeople`).
- Once an admin keeps the org's apps apart in Calimero Home (`shared`), an
  invite gives Mero Forms only (the dialog says so) and only its people are shown.
  Forms has no organization-level Remove or Leave: its team (who builds forms
  and reads responses) is the contract's, and only people in Mero Forms are
  offered for it.
- Adding Mero Forms to an organization whose apps have teams makes its team
  first: owners and admins only (anyone else is told so), open in an open org
  and closed in one that keeps its apps apart.
- An organization from before app teams stays **legacy** (organization
  access, org-wide invites). Under `pnpm dev:local` the app runs from a raw
  bundle, which has no package, so every organization is legacy there.

## Run it

```bash
rustup target add wasm32-wasip2
cargo test --manifest-path apps/mero-forms/logic/Cargo.toml        # harness + scenarios
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- build apps/mero-forms/logic

pnpm dev:local mero-forms        # merod local + deploy + the app on http://localhost:5173
pnpm merod-local e2e mero-forms  # the scenarios as real accounts on the cluster

pnpm -F mero-forms lint typecheck test build
```

`merod local` runs on Linux (core's release binary). The production build
needs `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` (see
`app/.env.example`); the production frontend is the one packed into the
bundle (`frontend-dir`).

## Layout

```
logic/src/lib.rs            the contract
logic/tests/harness.rs      TestApp tests: every method, keys, links, captchas, access
logic/scenarios/            neutral steps: run by cargo test and on merod local
app/src/formsApi.ts         the typed adapter: v1's method names and shapes over CalimeroClient
app/src/crmApi.ts           the Mero CRM calls the hand-off makes
app/src/FormsHome.tsx       templates and the form list
app/src/FormView.tsx        one form: Responses, Edit, Preview, Connect
app/src/FormBuilder.tsx     the question editor
app/src/FormFill.tsx        the form as a respondent sees it
app/src/Responses.tsx       summary, table, one response, Send to CRM
app/src/FormConnect.tsx     form keys
app/src/PublicLinks.tsx     public links: Public, the cap, the captcha, make and delete
app/src/PublicForm.tsx      the form opened from a public link (`/f#…`)
app/api/captcha.ts          the captcha verifier (a Vercel function)
app/src/CrmSettings.tsx     the CRM pipeline, stage and field mapping
app/src/useCrm.ts           finding pipelines and sending a response
app/src/lib/                pure, unit-tested: questions and answers, CRM mapping, links, orgs
app/src/session.ts          target -> client -> passkey sign-in/up (SessionStore)
app/src/WorkspacePicker.tsx workspaces (app instances) in your organizations
app/src/SignIn.tsx          the passkey sign-in and the invitation prompt
```
