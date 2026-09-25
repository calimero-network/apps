# mero-crm

A simple, private sales CRM built on [Calimero](https://calimero.network): a
visual pipeline, deals with a next step, the people behind them, a to-do list
that puts overdue follow-ups first, stage automations, insights, and a deal
assistant. The pipeline lives in a Calimero context and replicates directly
between your team's own nodes — no central server, no vendor holding your
customer list.

## What it does, and what it deliberately leaves out

The category (Pipedrive, HubSpot Sales, Close, Zoho, Attio, folk) converges on
the same core. That core is here; the long tail around it is not.

| Every CRM in the category has… | Here |
| --- | --- |
| A visual pipeline you drag deals through | **Pipeline** board: one column per stage with count, total and weighted value; drag to move, drop on **Won** / **Lost** to close. |
| Customisable stages with win probabilities | **Settings → Stages**: rename, re-weight, reorder, add, delete (refused while a stage holds open deals). |
| Deals with value, owner, contact, expected close, source | The deal page, edited in place. Value accepts shorthand (`12k`, `1.5m`). |
| People and organisations | **Contacts**, with each person's open deals and won value. |
| Activities: calls, meetings, tasks, emails, deadlines | Scheduled on a deal or standalone. The earliest open one is the deal's *next step*, shown on its card. |
| A to-do list | **Activities**, grouped Overdue / Today / Upcoming / Done, with one-click *Tomorrow* snooze. |
| "Rotting" deals | A deal idle past the pipeline's threshold (14 days by default) is flagged on the board. |
| Won / lost with a lost reason | One click to win; a lost reason (one-click presets) feeds the report. |
| Workflow automation | **Settings → Automations**: *when a deal enters stage X, schedule activity Y due in N days* — run inside the contract, so it fires whoever moves the deal. |
| Reporting and forecasting | **Insights**: open and weighted pipeline, won this month, win rate, average deal, sales cycle, value by stage, weighted forecast by close month, lost reasons, per-owner totals, deals that need attention. |
| An AI sales assistant | The **Deal assistant** on every deal (below). |
| Team access | The namespace is the team: invite links, roles, member names — the same shell as the rest of the fleet. |

Left out on purpose: email sync, calling, a marketplace, custom-field builders,
territories, quotes and products. Each is a product in itself, and none of them
is what closes the next deal.

### The deal assistant

Deterministic and local — it runs in the browser on the pipeline you already
replicate, and sends nothing anywhere:

- **Health score (0–100)** from the signals a sales manager checks by eye: no
  next step, an overdue step, days since anyone touched the deal, days in the
  current stage, a slipped or missing close date, no contact person, no owner.
  Paired with a **win likelihood** (stage probability adjusted by health).
- **Next best steps**: the playbook step for the deal's stage (discovery call →
  demo → proposal → follow-up → close), re-engagement for a rotting deal,
  and fixes for missing data — each schedulable or focusable in one click.
- **Follow-up email draft** appropriate to the stage, to copy, open in your
  mail app, or log as an email activity.
- **Copy AI coaching prompt**: the deal's full context (stage, value, health,
  activities, notes) as a prompt for whichever AI assistant you already use.

The rules live in `app/src/utils/crm.ts` as pure functions with unit tests.

## Layout

| Path | What |
| --- | --- |
| `logic/` | Rust WASM contract: stages, deals, contacts, activities, notes, automations, settings. One context = one pipeline. |
| `logic/workflows/smoke.yml` | Two-node merobox scenario calling every contract method, including the automation firing and the creator/author gates. |
| `app/` | React (Vite) frontend. The workspace shell (auth, desktop SSO, invitations, members, roles) is shared with mero-issue-tracker. |

## Data model

- `stages: UnorderedMap<String, Stage>` — name, probability and position as
  `LwwRegister`s. A new pipeline starts with *Lead in 10% → Qualified 25% →
  Meeting 40% → Proposal 60% → Negotiation 80%*, with fixed ids so every member
  receives the same entries.
- `deals: UnorderedMap<String, Deal>` — every mutable field its own register.
  `update_deal` writes only the fields that changed, so a teammate editing a
  different field of the same deal at the same time keeps their edit.
- `contacts`, `activities`, `notes`, `automations` — maps keyed by id.
- `currency`, `rotting_days` — pipeline settings.
- Money is `u64` whole units of the pipeline currency; no floats in replicated
  state.
- Only a deal's or contact's creator may delete it; only a note's author may
  delete the note. Enforced in the contract against the executing identity.

`list_deals` returns each deal with its next activity, open-activity count,
last touch and contact name, computed in one pass over activities and notes.

## Develop

```bash
pnpm install                                   # from the repo root
cargo test -p mero-crm                         # contract unit + convergence tests
cargo mero build -p mero-crm                   # wasm + res/abi.json
pnpm -F mero-crm codegen                       # ABI → app/src/generated/CrmClient.ts
pnpm -F mero-crm dev                           # http://localhost:5186
pnpm -F mero-crm test                          # vitest
```

End to end, against real nodes:

```bash
cargo mero bundle --manifest-path apps/mero-crm/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output apps/mero-crm/logic/dist/com.calimero.mero-crm.mpk
MEROD_BINARY=/path/to/merod pnpm -F mero-crm test:e2e     # Playwright
cd apps/mero-crm/logic && merobox bootstrap run workflows/smoke.yml
```

## Deploy

Vercel project `mero-crm`, Root Directory `apps/mero-crm/app`, output `dist` —
the convention in `docs/VERCEL.md`. The origin
`https://mero-crm.vercel.app` is the bundle's `frontend` and the login
callback's registered origin.
