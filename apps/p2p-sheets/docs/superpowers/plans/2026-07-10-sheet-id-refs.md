# Sheet id-refs + unique names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cross-sheet formula references id-based (`[sheetId]!cell`) with a frontend id↔name display layer, and enforce unique sheet names — fixing duplicate-name ambiguity and making rename O(1).

**Architecture:** The WASM logic stores and evaluates formulas with the stable sheet **id** as the qualifier; the React frontend translates id↔name only at the formula-bar boundary. Sheet names are kept unique (auto-suffix on create, reject on rename). No back-compat: existing local namespaces are wiped, so every stored formula is id-based from day one and the engine resolves ids only.

**Tech Stack:** Rust (WASM, `cargo test`, toolchain stable), React 19 + TypeScript + styled-components, vitest (node env — no component rendering), Vite.

## Global Constraints

- **Canonical reference token:** `[<sheet_id>]!<cell>` (e.g. `[sheet-1700000000000-deadbeef]!D11`). A range is qualified **once at its start** (`[id]!A9:F9`). Same-sheet refs stay bare (`D11`).
- **Sheet-id format** (already generated): `sheet-<timestamp>-<hex8>`, lowercase.
- **Sheet-name character restriction:** reject names containing any of `[` `]` `!` `:` `'` `"` or ASCII control chars, in addition to the existing empty/length rules.
- **Uniqueness:** auto-suffix ` (n)` on create; reject-with-error on explicit rename; compare trimmed names case-sensitively; renaming a sheet to its own current name is a no-op.
- **Rename is O(1):** no formula rewrite, no `recompute_all()`.
- **No migration:** the engine resolves id-qualifiers only; unknown id → `#REF!`. No name-resolution fallback in the engine.
- **No behavior regressions** elsewhere: same-sheet formulas, evaluation semantics, clipboard mechanics, and the reskin are untouched. Preserve all `data-testid`/`aria-label`s.
- **Commands:** logic — from `logic/`, `cargo test -p spreadsheet`. app — from `app/`, `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.

---

### Task 1: Sheet-name character validation (logic)

**Files:**
- Modify: `logic/crates/types/src/lib.rs` (add `validate_sheet_name` near `validate_label:63`)
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn validate_sheet_name(name: &str) -> Result<(), Error>` — consumed by Task 2 (`create_sheet`/`rename_sheet`).

- [ ] **Step 1: Write the failing test**

Add to `logic/crates/types/src/lib.rs` tests module:

```rust
#[test]
fn validate_sheet_name_accepts_normal() {
    assert!(validate_sheet_name("Q3 Budget").is_ok());
    assert!(validate_sheet_name("Sheet 1 (2)").is_ok());
}

#[test]
fn validate_sheet_name_rejects_delimiter_chars() {
    for bad in ["a!b", "a[b", "a]b", "a:b", "a'b", "a\"b"] {
        assert!(validate_sheet_name(bad).is_err(), "should reject {bad:?}");
    }
}

#[test]
fn validate_sheet_name_rejects_empty() {
    assert!(validate_sheet_name("   ").is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd logic && cargo test -p spreadsheet-types validate_sheet_name 2>/dev/null || cargo test -p types validate_sheet_name`
(If the crate name differs, use the package name from `logic/crates/types/Cargo.toml`.)
Expected: FAIL — `validate_sheet_name` not found.

- [ ] **Step 3: Implement**

Add after `validate_label` (line 73) in `logic/crates/types/src/lib.rs`:

```rust
/// Validate a sheet name: the `validate_label` rules plus a character
/// restriction so a name can never collide with the canonical `[id]!` reference
/// qualifier (and stays parseable when typed). Forbids `[ ] ! : ' "` and control
/// characters (mirrors Excel's forbidden set plus our delimiters).
pub fn validate_sheet_name(name: &str) -> Result<(), Error> {
    validate_label(name)?;
    const FORBIDDEN: &[char] = &['[', ']', '!', ':', '\'', '"'];
    if name.chars().any(|c| FORBIDDEN.contains(&c) || c.is_control()) {
        return Err(Error::Invalid(
            "sheet name may not contain [ ] ! : ' \" or control characters".into(),
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd logic && cargo test -p types validate_sheet_name` (use the actual `types` package name)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd logic && git add crates/types/src/lib.rs
git commit -m "feat(types): validate_sheet_name forbids reference-delimiter chars"
```

---

### Task 2: Unique sheet names — auto-suffix on create, reject on rename (logic)

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — `create_sheet` (~`:229-253`), `rename_sheet` (~`:255`), add a private `unique_sheet_name` helper
- Test: same file's tests module

**Interfaces:**
- Consumes: `validate_sheet_name` (Task 1).
- Produces: `create_sheet` returns the possibly-suffixed name in `SheetCreated`; `rename_sheet` returns `Err` on a duplicate target name.

- [ ] **Step 1: Write the failing tests**

Add to the tests module in `logic/crates/spreadsheet/src/lib.rs`:

```rust
#[test]
fn create_sheet_auto_suffixes_duplicate_names() {
    let mut app = make_app();
    app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
    app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
    app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
    let names: Vec<String> = app.call(|s| Ok(s.list_sheets()?.into_iter().map(|x| x.name).collect())).unwrap();
    assert!(names.contains(&"Sheet 1".to_string()));
    assert!(names.contains(&"Sheet 1 (2)".to_string()));
    assert!(names.contains(&"Sheet 1 (3)".to_string()));
}

#[test]
fn rename_to_an_existing_name_is_rejected() {
    let mut app = make_app();
    let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
    let _b = app.call(|s| s.create_sheet("Beta".into())).unwrap();
    assert!(app.call(|s| s.rename_sheet(a.clone(), "Beta".into())).is_err());
}

#[test]
fn rename_to_own_name_is_ok() {
    let mut app = make_app();
    let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
    assert!(app.call(|s| s.rename_sheet(a.clone(), "Alpha".into())).is_ok());
}

#[test]
fn rename_rejects_forbidden_chars() {
    let mut app = make_app();
    let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
    assert!(app.call(|s| s.rename_sheet(a.clone(), "Bad!Name".into())).is_err());
}
```

(Use whatever `list_sheets`/accessor the crate exposes; if the getter is named differently, adjust — the existing `rename_sheet_updates_name` test at `:1508` shows the accessor pattern.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd logic && cargo test -p spreadsheet create_sheet_auto_suffixes rename_to_an_existing rename_to_own rename_rejects_forbidden`
Expected: FAIL — duplicates currently allowed; rename doesn't validate chars.

- [ ] **Step 3: Add the `unique_sheet_name` helper**

Add as a private method on the app impl (near `create_sheet`) in `logic/crates/spreadsheet/src/lib.rs`:

```rust
/// Make `desired` unique among existing sheet names (excluding `exclude_id`),
/// auto-suffixing ` (2)`, ` (3)`, … on collision.
fn unique_sheet_name(&self, desired: &str, exclude_id: Option<&str>) -> app::Result<String> {
    let existing: Vec<String> = self
        .sheets
        .entries()
        .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
        .filter(|(id, _)| exclude_id != Some(id.as_str()))
        .map(|(_, d)| d.name.clone())
        .collect();
    if !existing.iter().any(|n| n == desired) {
        return Ok(desired.to_string());
    }
    for n in 2u32.. {
        let cand = format!("{desired} ({n})");
        if !existing.iter().any(|x| x == &cand) {
            return Ok(cand);
        }
    }
    Ok(desired.to_string()) // unreachable in practice
}
```

- [ ] **Step 4: Wire into `create_sheet`**

In `create_sheet`, replace the opening validation + name binding:

```rust
        validate_label(&name).map_err(AppError::from)?;
```
with:
```rust
        validate_sheet_name(&name).map_err(AppError::from)?;
        let name = self.unique_sheet_name(&name, None)?;
```
(Import `validate_sheet_name` alongside the existing `validate_label`/`generate_id` imports from the `types` crate at the top of the file.)

- [ ] **Step 5: Wire into `rename_sheet`**

In `rename_sheet`, replace:

```rust
        validate_label(&new_name).map_err(AppError::from)?;
```
with:
```rust
        validate_sheet_name(&new_name).map_err(AppError::from)?;
        // Reject a rename that collides with a DIFFERENT sheet (renaming to the
        // current name is a no-op below).
        let collides = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .any(|(id, d)| id != sheet_id && d.name == new_name);
        if collides {
            return Err(AppError::from(Error::Invalid(format!(
                "a sheet named '{new_name}' already exists"
            ))));
        }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd logic && cargo test -p spreadsheet`
Expected: the four new tests PASS; existing tests still pass (rename rewrite tests are handled in Task 4 — if `renaming_a_sheet_rewrites_references_to_it` now fails because names changed, leave it; Task 4 removes it. If it passes, fine.)

- [ ] **Step 7: Commit**

```bash
cd logic && git add crates/spreadsheet/src/lib.rs
git commit -m "feat(spreadsheet): unique sheet names — auto-suffix create, reject rename"
```

---

### Task 3: Evaluate id-qualified references (logic)

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — `split_sheet_qualifier` (~`:936`) → id form; `parse_factor` dispatch (~`:1210-1211`); `parse_ident` cross-sheet branch (~`:1257-1267`); remove `parse_quoted_ref` (~`:1279`); the `recompute_all` resolution closure (~`:571-626`)
- Test: same file's tests module (migrate the cross-sheet tests)

**Interfaces:**
- Produces: the engine resolves `[id]!cell` refs; unknown id → `#REF!`. Consumes nothing new.

- [ ] **Step 1: Migrate the cross-sheet tests to id form (write the failing tests)**

In `logic/crates/spreadsheet/src/lib.rs` tests:

Rewrite `cross_sheet_cell_and_range_references` (~`:1745`) so the formulas embed the real sheet id. Replace its formula strings:

```rust
    // Sheet1!B1 = =[data]!A1 + [data]!A2 → 30
    app.call(|s| s.set_cell_formula(s1.clone(), 0, 1, format!("=[{data}]!A1+[{data}]!A2")))
        .unwrap();
    // Sheet1!B2 = =SUM([data]!A1:A2) → 30
    app.call(|s| s.set_cell_formula(s1.clone(), 1, 1, format!("=SUM([{data}]!A1:A2)")))
        .unwrap();
```
(where `data` is the id variable already bound in that test; adjust the assertion comments similarly.)

Rewrite `reference_to_unknown_sheet_is_ref_error` (~`:1804`) to reference a non-existent id:

```rust
    app.call(|s| s.set_cell_formula(sid.clone(), 0, 0, "=[sheet-does-not-exist]!A1".into()))
        .unwrap();
    // resolves to #REF! because no sheet has that id
```
(keep its existing `#REF!` assertion.)

Rewrite `cross_sheet_recompute_propagates` (~`:1885`) the same way — swap any `Name!` qualifier for `[{id}]!` using the id variable bound in that test.

**Delete** `cross_sheet_quoted_name_with_space` (~`:1767`) and `cross_sheet_quoted_name_with_apostrophe` (~`:1782`) — quoted **names** no longer exist in canonical form (that concern moves to the frontend `sheetref.ts`, Task 5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd logic && cargo test -p spreadsheet cross_sheet reference_to_unknown`
Expected: FAIL — `[id]!` not yet parsed (resolves to `#VALUE!`/`0`).

- [ ] **Step 3: Convert `split_sheet_qualifier` to id form**

Replace the whole `split_sheet_qualifier` fn (~`:936-975`) with:

```rust
    /// Split an optional `[<sheet_id>]!` prefix off a reference. Returns
    /// `(sheet_id, rest)` — `sheet_id` is `None` for a same-sheet reference.
    fn split_sheet_qualifier(s: &str) -> (Option<String>, String) {
        let s = s.trim();
        if let Some(rest) = s.strip_prefix('[') {
            if let Some(end) = rest.find(']') {
                let id = &rest[..end];
                let after = &rest[end + 1..];
                if let Some(cell) = after.trim_start().strip_prefix('!') {
                    return (Some(id.to_string()), cell.trim().to_string());
                }
            }
        }
        (None, s.to_string())
    }
```

- [ ] **Step 4: Add `parse_bracket_ref` and update `parse_factor` / `parse_ident`**

Add a new fn near `parse_quoted_ref`:

```rust
    /// Parse an id-qualified reference `[sheet-id]!A1` as a number.
    fn parse_bracket_ref(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        *p += 1; // opening '['
        let ids = *p;
        while *p < c.len() && c[*p] != ']' { *p += 1; }
        if c.get(*p) != Some(&']') { return None; }
        let id: String = c[ids..*p].iter().collect();
        *p += 1; // ']'
        if c.get(*p) != Some(&'!') { return None; }
        *p += 1; // '!'
        let cs = *p;
        while *p < c.len() && c[*p].is_ascii_uppercase() { *p += 1; }
        while *p < c.len() && c[*p].is_ascii_digit() { *p += 1; }
        let refstr: String = c[cs..*p].iter().collect();
        let (row, col) = parse_cell_ref(&refstr)?;
        cell_num(gv, Some(&id), row, col)
    }
```

In `parse_factor` (~`:1210`), replace the quoted-ref arm:
```rust
            '\'' => parse_quoted_ref(c, p, gv),
```
with:
```rust
            '[' => parse_bracket_ref(c, p, gv),
```

In `parse_ident` (~`:1257-1267`), **remove** the cross-sheet branch (the `if c.get(*p) == Some(&'!') { … return cell_num(gv, Some(&name), …) }` block) — a bare `name!` qualifier no longer occurs. Keep the function-call handling and the plain same-sheet cell handling that follow it.

**Delete** `parse_quoted_ref` (~`:1278-1309`) entirely.

- [ ] **Step 5: Resolve by id in the recompute closure**

In `recompute_all`, replace the name→id map (~`:571-577`):
```rust
        // Sheet name → id, so cross-sheet references resolve by name.
        let sheets: Vec<(String, String)> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, d)| (d.name.clone(), id))
            .collect();
```
with:
```rust
        // Existing sheet ids — cross-sheet references resolve by id.
        let sheet_ids: Vec<String> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, _)| id)
            .collect();
```

And in the closure (~`:616-626`), replace:
```rust
                        let sid = match sheet {
                            Some(name) => match sheets.iter().find(|(n, _)| n == name) {
                                Some((_, id)) => id.as_str(),
                                None => {
                                    bad_sheet.set(true);
                                    return None;
                                }
                            },
                            None => cur_sheet.as_str(),
                        };
```
with:
```rust
                        let sid = match sheet {
                            Some(id) => {
                                if sheet_ids.iter().any(|s| s == id) {
                                    id
                                } else {
                                    bad_sheet.set(true);
                                    return None;
                                }
                            }
                            None => cur_sheet.as_str(),
                        };
```

- [ ] **Step 6: Run the full logic suite**

Run: `cd logic && cargo test -p spreadsheet`
Expected: the migrated cross-sheet tests PASS; `#REF!` on unknown id PASS. `renaming_a_sheet_rewrites_references_to_it` may now FAIL (it asserts name-rewrite) — that is expected and is removed in Task 4; if it blocks the run, you may delete it now as part of this task.

- [ ] **Step 7: Commit**

```bash
cd logic && git add crates/spreadsheet/src/lib.rs
git commit -m "feat(spreadsheet): resolve cross-sheet refs by id ([id]!cell)"
```

---

### Task 4: O(1) rename — drop ref-rewrite + recompute (logic)

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — `rename_sheet` body (~`:278-320`), delete `rewrite_sheet_qualifiers` (~`:1000`) and `sheet_prefix` (~`:981`) if now unused
- Test: same file's tests module

**Interfaces:** none new.

- [ ] **Step 1: Replace the rename-rewrite test with a "rename touches nothing" test**

Delete `renaming_a_sheet_rewrites_references_to_it` (~`:1826`). Add:

```rust
#[test]
fn rename_does_not_touch_formulas_or_values() {
    let mut app = make_app();
    let data = app.call(|s| s.create_sheet("Data".into())).unwrap();
    let main = app.call(|s| s.create_sheet("Main".into())).unwrap();
    app.call(|s| s.set_cell(data.clone(), 0, 0, "10".into())).unwrap();
    let formula = format!("=[{data}]!A1*2");
    app.call(|s| s.set_cell_formula(main.clone(), 0, 0, formula.clone())).unwrap();
    let before = app.call(|s| Ok(s.get_cells(main.clone())?)).unwrap();
    let cell_before = before.iter().find(|c| c.row == 0 && c.col == 0).unwrap().clone();
    assert_eq!(cell_before.computed_value, "20");

    app.call(|s| s.rename_sheet(data.clone(), "Renamed".into())).unwrap();

    let after = app.call(|s| Ok(s.get_cells(main.clone())?)).unwrap();
    let cell_after = after.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
    // raw formula unchanged (id-based), computed value unchanged.
    assert_eq!(cell_after.raw_value, formula, "rename must not rewrite the formula");
    assert_eq!(cell_after.computed_value, "20", "rename must not change values");
}
```

- [ ] **Step 2: Run test to verify it fails / behavior**

Run: `cd logic && cargo test -p spreadsheet rename_does_not_touch`
Expected: currently PASSES on value but the rewrite loop is still present (dead work). It becomes meaningful after Step 3; run to confirm it compiles and passes.

- [ ] **Step 3: Strip the rewrite + recompute from `rename_sheet`**

In `rename_sheet`, delete the entire `if old_name != new_name { … rewrite_sheet_qualifiers … }` block (~`:278-308`) and the trailing `self.recompute_all()?;` (~`:317`). The body should reduce to: validate, reject-collision (from Task 2), capture nothing about old_name for rewriting, set `guard.name = new_name` + `updated_at`, emit `SheetRenamed`, `Ok(())`. Remove the now-unused `old_name` capture if it's only used by the deleted block.

- [ ] **Step 4: Delete now-dead helpers**

Delete `pub fn rewrite_sheet_qualifiers` (~`:1000-1058`) and its unit tests (search for `rewrite_sheet_qualifiers(` in tests and remove those cases). Delete `pub fn sheet_prefix` (~`:981-992`) if `cargo test` reports it unused (it was only used by the rewriter). If the compiler flags any other unused item exposed by these deletions, remove it too.

- [ ] **Step 5: Run the full logic suite**

Run: `cd logic && cargo test -p spreadsheet`
Expected: all pass; no dead-code warnings for the deleted helpers.

- [ ] **Step 6: Commit**

```bash
cd logic && git add crates/spreadsheet/src/lib.rs
git commit -m "perf(spreadsheet): O(1) rename — id-refs need no rewrite or recompute"
```

---

### Task 5: Frontend id↔name translation module (app)

**Files:**
- Create: `app/src/spreadsheet/sheetref.ts`
- Test: `app/src/spreadsheet/sheetref.test.ts`

**Interfaces:**
- Consumes: `sheetPrefix` from `./refs`.
- Produces (consumed by Task 7):
  - `idsToNames(formula: string, nameOf: (id: string) => string | null): string`
  - `namesToIds(formula: string, idOf: (name: string) => string | null): string`

- [ ] **Step 1: Write the failing test**

Create `app/src/spreadsheet/sheetref.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { idsToNames, namesToIds } from './sheetref';

const NAME: Record<string, string> = { 'sheet-1-aa': 'Data', 'sheet-2-bb': 'Q3 Budget' };
const ID: Record<string, string> = { Data: 'sheet-1-aa', 'Q3 Budget': 'sheet-2-bb' };
const nameOf = (id: string) => NAME[id] ?? null;
const idOf = (name: string) => ID[name] ?? null;

describe('idsToNames', () => {
  it('renders a bare-name qualifier', () => {
    expect(idsToNames('=[sheet-1-aa]!A1', nameOf)).toBe('=Data!A1');
  });
  it('quotes a name that needs quoting and qualifies a range once', () => {
    expect(idsToNames('=SUM([sheet-2-bb]!A9:F9)', nameOf)).toBe("=SUM('Q3 Budget'!A9:F9)");
  });
  it('leaves an unknown id untouched', () => {
    expect(idsToNames('=[sheet-x]!A1', nameOf)).toBe('=[sheet-x]!A1');
  });
  it('does not touch ids inside string literals', () => {
    expect(idsToNames('="[sheet-1-aa]!A1"', nameOf)).toBe('="[sheet-1-aa]!A1"');
  });
  it('passes through non-formula text', () => {
    expect(idsToNames('42', nameOf)).toBe('42');
  });
});

describe('namesToIds', () => {
  it('maps a bare name qualifier to its id', () => {
    expect(namesToIds('=Data!A1', idOf)).toBe('=[sheet-1-aa]!A1');
  });
  it('maps a quoted name and qualifies a range once', () => {
    expect(namesToIds("=SUM('Q3 Budget'!A9:F9)", idOf)).toBe('=SUM([sheet-2-bb]!A9:F9)');
  });
  it('leaves a same-sheet cell ref alone', () => {
    expect(namesToIds('=A1+B2', idOf)).toBe('=A1+B2');
  });
  it('leaves an unknown name verbatim', () => {
    expect(namesToIds('=Ghost!A1', idOf)).toBe('=Ghost!A1');
  });
  it('does not touch names inside string literals', () => {
    expect(namesToIds('="Data!A1"', idOf)).toBe('="Data!A1"');
  });
});

describe('round-trip', () => {
  it('names → ids → names is identity for known sheets', () => {
    const display = "=SUM(Data!A1, 'Q3 Budget'!B2:C4)";
    expect(idsToNames(namesToIds(display, idOf), nameOf)).toBe(display);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/spreadsheet/sheetref.test.ts`
Expected: FAIL — module `./sheetref` not found.

- [ ] **Step 3: Implement**

Create `app/src/spreadsheet/sheetref.ts`:

```ts
/**
 * Translate a formula's sheet qualifiers between the CANONICAL id form
 * (`[sheetId]!A1`, what is stored + evaluated) and the DISPLAY name form
 * (`Data!A1` / `'Q3 Budget'!A1`, what the formula bar shows). Only the qualifier
 * is rewritten; cell/range/function grammar is untouched. `"…"` string literals
 * are skipped so ref-shaped text inside them is never rewritten.
 */
import { sheetPrefix } from './refs';

/** Canonical `[id]!` → display name qualifier. Unknown id → left verbatim. */
export function idsToNames(formula: string, nameOf: (id: string) => string | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      out += ch; i++;
      while (i < formula.length) { out += formula[i]; if (formula[i] === '"') { i++; break; } i++; }
      continue;
    }
    if (ch === '[') {
      const end = formula.indexOf(']', i + 1);
      if (end !== -1 && formula[end + 1] === '!') {
        const id = formula.slice(i + 1, end);
        const name = nameOf(id);
        out += name != null ? sheetPrefix(name) : `[${id}]!`;
        i = end + 2; // past ']!'
        continue;
      }
    }
    out += ch; i++;
  }
  return out;
}

/** Display name qualifier → canonical `[id]!`. Unknown name → left verbatim. */
export function namesToIds(formula: string, idOf: (name: string) => string | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      out += ch; i++;
      while (i < formula.length) { out += formula[i]; if (formula[i] === '"') { i++; break; } i++; }
      continue;
    }
    if (ch === "'") {
      // Quoted sheet name: read to the lone closing quote, collapsing `''`.
      let j = i + 1; let name = ''; let terminated = false;
      while (j < formula.length) {
        if (formula[j] === "'") {
          if (formula[j + 1] === "'") { name += "'"; j += 2; }
          else { j += 1; terminated = true; break; }
        } else { name += formula[j]; j++; }
      }
      if (terminated && formula[j] === '!') {
        const id = idOf(name);
        out += id != null ? `[${id}]!` : formula.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      out += formula.slice(i, j); i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      // Alphanumeric run: a trailing '!' makes it a bare sheet-name qualifier;
      // otherwise it is a cell ref (A1) or function name (SUM) — emit verbatim.
      let j = i;
      while (j < formula.length && /[A-Za-z0-9]/.test(formula[j])) j++;
      if (formula[j] === '!') {
        const name = formula.slice(i, j);
        const id = idOf(name);
        out += id != null ? `[${id}]!` : formula.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      out += formula.slice(i, j); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/spreadsheet/sheetref.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/spreadsheet/sheetref.ts src/spreadsheet/sheetref.test.ts
git commit -m "feat(sheetref): pure id<->name formula-qualifier translation"
```

---

### Task 6: Cross-sheet copy qualifies by id (app)

**Files:**
- Modify: `app/src/spreadsheet/shift.ts` — `qualifyFormula` (id prefix + skip `[…]` spans in `transformRefs`)
- Modify: `app/src/spreadsheet/paste.ts` — `planPaste` `crossSheet` carries `sourceSheetId`
- Test: `app/src/spreadsheet/shift.test.ts`, `app/src/spreadsheet/paste.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `qualifyFormula(formula: string, sheetId: string): string` emits `[sheetId]!`; `planPaste(payload, anchor, crossSheet?: { sourceSheetId: string | null } | null)`.

- [ ] **Step 1: Update the failing tests**

In `app/src/spreadsheet/shift.test.ts`, replace the `qualifyFormula` describe block's expectations to id form (the source sheet is now an id):

```ts
describe('qualifyFormula', () => {
  it('qualifies a standalone ref with the source sheet id', () => {
    expect(qualifyFormula('=A9', 'sheet-1-aa')).toBe('=[sheet-1-aa]!A9');
  });
  it('qualifies a range once at the start', () => {
    expect(qualifyFormula('=SUM(A9:F9)', 'sheet-1-aa')).toBe('=SUM([sheet-1-aa]!A9:F9)');
  });
  it('qualifies every standalone ref in an expression', () => {
    expect(qualifyFormula('=A1+B2', 'sheet-1-aa')).toBe('=[sheet-1-aa]!A1+[sheet-1-aa]!B2');
  });
  it('preserves absolute markers under the qualifier', () => {
    expect(qualifyFormula('=$A$9', 'sheet-1-aa')).toBe('=[sheet-1-aa]!$A$9');
  });
  it('leaves already-qualified refs untouched', () => {
    expect(qualifyFormula('=SUM([sheet-2-bb]!A1:A3)', 'sheet-1-aa')).toBe('=SUM([sheet-2-bb]!A1:A3)');
  });
  it('does not qualify function names or string literals', () => {
    expect(qualifyFormula('=ATAN2(A1)', 'sheet-1-aa')).toBe('=ATAN2([sheet-1-aa]!A1)');
    expect(qualifyFormula('=IF(A1>0,"A1",A1)', 'sheet-1-aa')).toBe('=IF([sheet-1-aa]!A1>0,"A1",[sheet-1-aa]!A1)');
  });
  it('passes through non-formula text', () => {
    expect(qualifyFormula('42', 'sheet-1-aa')).toBe('42');
  });
});
```

In `app/src/spreadsheet/paste.test.ts`, update the cross-sheet block to pass `sourceSheetId`:

```ts
describe('planPaste — cross-sheet copy', () => {
  it('qualifies formula refs to the source sheet id instead of shifting', () => {
    const w = planPaste(single('=SUM(A9:F9)'), { row: 4, col: 2 }, { sourceSheetId: 'sheet-src' });
    expect(w[0].raw).toBe('=SUM([sheet-src]!A9:F9)');
  });
  it('still positions the cell by anchor + dr/dc', () => {
    const w = planPaste(single('=A1'), { row: 4, col: 2 }, { sourceSheetId: 'sheet-src' });
    expect(w[0]).toEqual({ row: 4, col: 2, raw: '=[sheet-src]!A1', format: '' });
  });
  it('pastes verbatim (never #REF!) when the source sheet id is unknown', () => {
    const w = planPaste(single('=SUM(A9:F9)'), { row: 4, col: 2 }, { sourceSheetId: null });
    expect(w[0].raw).toBe('=SUM(A9:F9)');
  });
  it('leaves a cut untouched even across sheets', () => {
    const w = planPaste(single('=A1', true), { row: 4, col: 2 }, { sourceSheetId: 'sheet-src' });
    expect(w[0].raw).toBe('=A1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/spreadsheet/shift.test.ts src/spreadsheet/paste.test.ts`
Expected: FAIL — `qualifyFormula` still emits name-prefix; `planPaste` still expects `sourceSheetName`.

- [ ] **Step 3: Update `qualifyFormula` and skip `[…]` spans in the scanner**

In `app/src/spreadsheet/shift.ts`, change `qualifyFormula` to take an id and emit brackets:

```ts
export function qualifyFormula(formula: string, sheetId: string): string {
  const prefix = `[${sheetId}]!`;
  return transformRefs(formula, (token, prev) =>
    prev === '!' || prev === ':' ? token : `${prefix}${token}`,
  );
}
```
Remove the now-unused `sheetPrefix` import if `shift.ts` no longer uses it.

In `transformRefs` (same file), add a `[…]` skip so an id's interior is never tokenised — right after the `'"'` string-literal branch, before the `REF_RE` match:

```ts
    if (ch === '[') {
      // Canonical `[id]!` qualifier — copy the bracketed span verbatim so the
      // id's digits/letters are never treated as a cell ref. The cell after `!`
      // is handled normally by the ref branch (prev char `!`).
      const end = formula.indexOf(']', i + 1);
      if (end !== -1) {
        out += formula.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
```

- [ ] **Step 4: Update `planPaste` cross-sheet param**

In `app/src/spreadsheet/paste.ts`, change the `crossSheet` param type and body from name to id:

```ts
export function planPaste(
  payload: ClipPayload,
  anchor: CellCoord,
  crossSheet?: { sourceSheetId: string | null } | null,
): PasteWrite[] {
  const dRow = anchor.row - payload.sourceRect.top;
  const dCol = anchor.col - payload.sourceRect.left;
  return payload.cells.map((c) => {
    let raw = c.raw;
    if (!payload.cut && c.raw.startsWith('=')) {
      if (crossSheet) {
        raw =
          crossSheet.sourceSheetId != null
            ? qualifyFormula(c.raw, crossSheet.sourceSheetId)
            : c.raw; // cross-sheet, source id unknown → verbatim (never #REF!)
      } else {
        raw = shiftFormula(c.raw, dRow, dCol);
      }
    }
    return { row: anchor.row + c.dr, col: anchor.col + c.dc, raw, format: c.format };
  });
}
```
Update the comment above the param accordingly (source **id**, not name).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run src/spreadsheet/shift.test.ts src/spreadsheet/paste.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/spreadsheet/shift.ts src/spreadsheet/shift.test.ts src/spreadsheet/paste.ts src/spreadsheet/paste.test.ts
git commit -m "feat(paste): cross-sheet copy qualifies formulas by sheet id"
```

---

### Task 7: Wire id↔name into AppPage + fix default-sheet race (app)

**Files:**
- Modify: `app/src/pages/app/AppPage.tsx` — imports; formula load (~`:165-171`) and cancel (~`:348-354`); `commitCell` (~`:186-191`); `buildClip` already sets `sourceSheetId`; paste `crossSheet` (~`:569`); the `ensureDefaultSheetRef` effect (~`:124-136`)

**Interfaces:**
- Consumes: `idsToNames`/`namesToIds` (Task 5); `qualifyFormula`/`planPaste` id form (Task 6).

Note: integration — no unit test (node env can't render). Verify by `tsc` + full suite green + build + manual.

- [ ] **Step 1: Add imports and id↔name maps**

At the top of `app/src/pages/app/AppPage.tsx` add:

```ts
import { idsToNames, namesToIds } from '../../spreadsheet/sheetref';
```

After the `ss` hook call (~`:51`), add memoised resolvers:

```ts
  const idToName = useCallback(
    (id: string) => ss.sheets.find((s) => s.id === id)?.name ?? null,
    [ss.sheets],
  );
  const nameToId = useCallback(
    (name: string) => ss.sheets.find((s) => s.name === name)?.id ?? null,
    [ss.sheets],
  );
```

- [ ] **Step 2: Translate id→name when loading a formula into the bar**

In the effect that syncs the formula bar (~`:165-171`), wrap the raw value:
```ts
    setFormulaInput(cell?.raw_value ?? '');
```
→
```ts
    setFormulaInput(idsToNames(cell?.raw_value ?? '', idToName));
```
Add `idToName` to that effect's dependency array.

Do the same in `handleFormulaCancel` (~`:354`):
```ts
    setFormulaInput(cell?.raw_value ?? '');
```
→
```ts
    setFormulaInput(idsToNames(cell?.raw_value ?? '', idToName));
```
and add `idToName` to its deps.

- [ ] **Step 3: Translate name→id when committing**

In `commitCell` (~`:186`), replace:
```ts
    const value = formulaInput;
```
with:
```ts
    const value = namesToIds(formulaInput, nameToId);
```
Add `nameToId` to `commitCell`'s dependency array. (The empty/clear check `if (!value.trim())` still works — `namesToIds` returns non-formula text unchanged.)

- [ ] **Step 4: Pass the source sheet id to cross-sheet paste**

In `handlePaste` (~`:569`), the `crossSheet` computation currently resolves a name; replace it to pass the id directly:
```ts
      const crossSheet =
        internal && clipboard!.sourceSheetId !== activeSheetId
          ? { sourceSheetId: clipboard!.sourceSheetId }
          : null;
```
(`clipboard!.sourceSheetId` is already captured in `buildClip`.) The `planPaste(clipboard!, anchor, crossSheet)` call is unchanged.

- [ ] **Step 5: Fix the default-sheet create race**

Add a ref that durably marks contexts this client created (so the safety-net never races `initProject`). After the other `useRef`s (~`:90-97`) add:
```ts
  // Contexts we created — their default sheet comes from initProject, so the
  // ensure-default safety net must not also create one (it would duplicate).
  const selfCreatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (ws.contextId && ws.pendingInitName) selfCreatedRef.current.add(ws.contextId);
  }, [ws.contextId, ws.pendingInitName]);
```

In the `ensureDefaultSheetRef` effect condition (~`:124-133`), add a guard so it skips self-created contexts:
```ts
      ss.ready &&
      ss.loaded &&
      ss.sheets.length === 0 &&
      ss.cells.length === 0 &&
      ws.contextId &&
      !selfCreatedRef.current.has(ws.contextId) &&
      ensuredDefaultSheetRef.current !== ws.contextId
```

- [ ] **Step 6: Verify types, suite, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all app tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/pages/app/AppPage.tsx
git commit -m "feat(app): id<->name formula translation + fix default-sheet race"
```

---

## Self-Review

**Spec coverage:**
- Canonical `[id]!` token → Tasks 3 (parse/eval), 5 (translate), 6 (copy). ✓
- Sheet-name char restriction → Task 1. ✓
- Unique names (auto-suffix create / reject rename, case-sensitive, self-rename no-op) → Task 2. ✓
- Engine resolves by id, unknown id → `#REF!`, no name fallback → Task 3. ✓
- O(1) rename (no rewrite, no recompute), delete `rewrite_sheet_qualifiers` → Task 4. ✓
- Frontend translation boundary (load id→name, commit name→id) → Tasks 5, 7. ✓
- Cross-sheet copy qualifies by id → Task 6 + Task 7 wiring. ✓
- Default-create race fix → Task 7. ✓
- No migration (tests migrated to id form; quoted-name engine tests removed) → Task 3. ✓

**Placeholder scan:** none — every code step carries complete code; the only soft spots are "use the actual `types` package name" (Task 1/2 commands) and "adjust the accessor if named differently" (Task 2 test) — both are concrete lookups the implementer resolves from the crate's `Cargo.toml`/existing tests, not open design.

**Type consistency:** `qualifyFormula(formula, sheetId)` (Task 6) matches its call in `planPaste` and the `crossSheet: { sourceSheetId }` shape used in Task 7. `idsToNames`/`namesToIds` signatures (Task 5) match their calls in Task 7. `validate_sheet_name` (Task 1) matches its use in Task 2. `split_sheet_qualifier` returns `(Option<id>, rest)` and the recompute closure treats `sheet` as an id (Task 3), consistent with `parse_bracket_ref` passing `Some(&id)` to `cell_num`/`gv`.

**Ordering:** logic 1→2→3→4 (rename O(1) depends on id-resolution); frontend 5→6→7. Frontend is independent of logic at the test level (each suite self-contained); both are required for the end-to-end behavior, exercised at deploy/manual.

## Deploy (after all tasks)

Rebuild the WASM bundle and reinstall to the local node, then **wipe all existing namespaces** (user-approved) so the app recreates against the new logic with id-based refs. Frontend rebuild is a normal `vite build`. Deploy path per the meroctl memory (brew meroctl + `node add` OAuth; namespace delete = `DELETE /admin-api/namespaces/{id}` with body `{}`). Do NOT refresh/rotate the meroctl token.
