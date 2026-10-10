# mero-books

Small-business accounting built on [Calimero](https://calimero.network), in
the shape of Xero: invoices and bills, the payments against them, money spent
and received straight through the bank, bank statement reconciliation, manual
journals, and the reports an accountant asks for. One organisation's books
live in a Calimero context and replicate directly between your team's own
nodes — there is no vendor holding a copy of your finances.

## What it does, and what it deliberately leaves out

| Every small-business ledger has… | Here |
| --- | --- |
| A chart of accounts | **Accounting → Chart of accounts**: a standard chart to start (bank, receivables, sales, expenses, tax, equity), editable; accounts with history are archived rather than deleted. |
| Tax rates | **Accounting → Tax rates**, called Tax, VAT, GST or Sales Tax in Settings. Each saved line keeps the rate it was saved with. |
| Sales invoices | **Sales**: line items, tax exclusive / inclusive / none, numbered `INV-0001…` on approval, printable, copy, email, part payments, overdue. |
| Bills | **Purchases**: the same document from the supplier's side, with their reference. |
| Spend and receive money | **Bank → Spend money / Receive money**: a bank movement coded straight to accounts. |
| Transfers | **Bank → Transfer**: between two bank accounts. |
| Bank reconciliation | **Bank → account → Import a statement** (any bank's CSV), then accept the suggested matches, match by hand, or code a line straight to an account. |
| Manual journals | **Accounting → Manual journals**, refused unless debits equal credits. |
| Voids, not edits | Approved documents, payments, transactions and journals are voided, never edited or deleted, with the reason and the member in the history. |
| Lock dates | **Settings → Lock date**: nothing on or before it can be posted or voided. |
| Reports | **Reports**: Profit and Loss, Balance Sheet (current-year earnings and retained earnings by financial year), Trial Balance, Aged Receivables, Aged Payables, the tax return, and Account Transactions (the general ledger), each exportable to CSV and printable. |
| A dashboard | Bank balances and items to reconcile, what customers owe and what is overdue, bills to pay, six months of cash in and out, profit for the year. |
| Team access | The namespace is the team: invite links, roles, member names — the same shell as the rest of the fleet. |

Left out on purpose: payroll, inventory, multi-currency, fixed-asset
depreciation schedules, bank feeds (statements are imported), quotes and
purchase orders, and budgets. Each is a product in itself.

## Layout

| Path | What |
| --- | --- |
| `logic/src/lib.rs` | The contract: state, validation, every method. One context = one organisation. |
| `logic/src/ledger.rs` | The ledger, derived on read, and every report computed from it. |
| `logic/src/money.rs` | Integer money, line maths and calendar dates — what every node must agree on to the byte. |
| `logic/src/model.rs` | Stored records and the views callers receive. |
| `logic/src/tests.rs`, `logic/tests/converge.rs` | 40 unit tests (accounting rules, then attacks a patched node could make) and replica-convergence tests. |
| `logic/workflows/smoke.yml` | Two-node merobox scenario calling every contract method, asserting every report against figures worked out by hand in its header. |
| `app/` | React (Vite) frontend. The workspace shell (auth, desktop SSO, invitations, members, roles) is shared with mero-crm. `app/src/utils/books.ts` holds every pure helper, mirrored line maths included, with unit tests. |

## Data model, and why

Three rules, each answering "what goes wrong when a member's node runs code
other than ours" (see [`apps/mero-chess/docs/trust-model.md`](../mero-chess/docs/trust-model.md)):

- **Posted records are write-once.** `approvals`, `payments`,
  `bank_transactions`, `journals` and `voids` are `WriteOnce` collections.
  Approving an invoice freezes a self-contained copy (contact, dates, lines
  with their tax rates) into `approvals`; the ledger reads that copy and never
  the draft row, so a write to the draft's registers after approval changes
  nothing posted. No node accepts an edit or removal of a write-once entry, and
  who posted it is the entry's owner stamp, not a field.
- **Nothing is a stored balance.** The general ledger is derived on read from
  the live posted records (`ledger.rs`), and so is every report, an invoice's
  status, what is paid on it, a contact's balance, the invoice number (position
  among approvals ordered by approval time) and whether a statement line is
  reconciled (its match must be live and move the same amount through the same
  account). There is no running total for two replicas to merge differently.
- **Working data is shared.** `accounts`, `tax_rates`, `contacts`, draft
  `invoices` and `statement_lines` are the team's, writable by every member,
  every mutable field its own `LwwRegister`; updates write only the fields that
  changed, so concurrent edits to different fields both survive.

Details worth knowing:

- Money is `i64` minor units, quantities thousandths, tax rates basis points,
  dates `YYYY-MM-DD` strings (a calendar day, not an instant). No floats.
  Values out of range — which only a patched node can write — are clamped on read.
- An unbalanced journal (only writable around the API) is left out of the
  ledger and shown as such, so someone voids it.
- A second approval filed at the same invoice id (again, only from a patched
  node) is flagged as a conflict; the earliest is used.
- Statement line ids are a hash of their content, so the same statement
  imported on two machines, or an overlapping export imported twice, is one set
  of lines.
- `history` is `Authored`: the audit trail and notes, each entry its author's.
- Not enforced by storage: a member's modified node can still void a record
  (voids are open to every member, as on paper) or delete shared working data.
  The ledger rules above are what keep it from rewriting a posted amount.

Each posting rule debits exactly what it credits, so the trial balance
balances by construction; `tests::the_ledger_always_balances` and every
report test hold that.

## Develop

```bash
pnpm install                                   # from the repo root
cargo test -p mero-books                       # contract unit + convergence tests
cargo mero build -p mero-books                 # wasm + res/abi.json
pnpm -F mero-books codegen                     # ABI → app/src/generated/BooksClient.ts
pnpm -F mero-books dev                         # http://localhost:5194
pnpm -F mero-books test                        # vitest
```

End to end, against real nodes:

```bash
cargo mero bundle --manifest-path apps/mero-books/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output apps/mero-books/logic/dist/com.calimero.mero-books.mpk
MEROD_BINARY=/path/to/merod pnpm -F mero-books test:e2e     # Playwright
cd apps/mero-books/logic && merobox bootstrap run workflows/smoke.yml
```

## Deploy

Vercel project `mero-books`, Root Directory `apps/mero-books/app`, output
`dist` — the convention in `docs/VERCEL.md`. The origin
`https://mero-books.vercel.app` is the bundle's `frontend` and the login
callback's registered origin. **The Vercel project is not created yet.**
