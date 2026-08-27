/// Evaluate a spreadsheet formula string.
///
/// `formula` should start with `=`. `get_value(sheet, row, col)` maps a cell
/// to its current computed value: `sheet` is `None` for a reference on the
/// current sheet, or `Some(name)` for a cross-sheet reference (`Data!A1` or
/// `'My Sheet'!A1`). Rows/cols are 0-indexed as used by the API; references
/// use 1-indexed rows and A-Z columns (e.g. `A1` → row 0, col 0).
pub fn evaluate(formula: &str, get_value: impl Fn(Option<&str>, u32, u32) -> Option<String>) -> String {
    let expr = formula.trim().strip_prefix('=').unwrap_or(formula).trim();
    // `$` marks an absolute reference (a fill/copy anchor). It has no effect
    // on evaluation, so strip it and `=$A$1` evaluates exactly like `=A1`.
    // Only strip it OUTSIDE double-quoted string literals, so a string like
    // `"$5"` keeps its `$` (the evaluator supports string literals via IF).
    let mut cleaned = String::with_capacity(expr.len());
    let mut in_string = false;
    for ch in expr.chars() {
        match ch {
            '"' => {
                in_string = !in_string;
                cleaned.push(ch);
            }
            '$' if !in_string => {} // absolute-ref anchor: drop it
            _ => cleaned.push(ch),
        }
    }
    eval_to_string(&cleaned, &get_value)
}

/// Evaluate an expression to its display string.
fn eval_to_string(expr: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> String {
    let expr = expr.trim();
    if expr.is_empty() {
        return String::new();
    }

    // Error tokens propagate verbatim. A formula that references a cell
    // shifted out of range is stored as `=#REF!`; without this, it falls
    // through to `split_sheet_qualifier`/`parse_cell_ref` (which only
    // recognize the `[id]!cell` form), fails to parse as a reference, and
    // the value collapses to `#VALUE!`.
    if matches!(
        expr,
        "#REF!" | "#VALUE!" | "#DIV/0!" | "#NAME?" | "#NUM!" | "#NULL!" | "#N/A" | "#CYCLE!"
    ) {
        return expr.to_string();
    }

    // String literal in double quotes.
    if expr.len() >= 2 && expr.starts_with('"') && expr.ends_with('"') {
        return expr[1..expr.len() - 1].to_string();
    }

    // A single top-level function call — evaluated here so it can return
    // string results (IF) and specific error strings (#DIV/0!, #NAME?).
    if let Some(result) = try_function(expr, get_value) {
        return result;
    }

    // Numeric expression: arithmetic (`+ - * /`, parens, unary), cell
    // references, numeric literals, and functions used as operands.
    if let Some(n) = eval_number(expr, get_value) {
        return format_num(n);
    }

    // Bare cell reference holding non-numeric text (possibly cross-sheet).
    let (sheet, rest) = split_sheet_qualifier(expr);
    if let Some((row, col)) = parse_cell_ref(&rest) {
        return get_value(sheet.as_deref(), row, col).unwrap_or_default();
    }

    "#VALUE!".to_string()
}

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

/// If `expr` is exactly a single `NAME(args)` call, evaluate it; else
/// `None` (so `SUM(..)+1` and bare arithmetic fall to the number parser).
fn try_function(expr: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<String> {
    let paren = expr.find('(')?;
    let name = &expr[..paren];
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    // The call must span the whole expression: strip the trailing ')' and
    // require the inner parens to balance. `SUM(A1:A2)+1` fails this (the
    // string doesn't end in ')'), so it's owned by the arithmetic parser.
    let inner = expr[paren + 1..].strip_suffix(')')?;
    if !parens_balanced(inner) {
        return None;
    }

    match name.to_uppercase().as_str() {
        "SUM" => Some(format_num(collect_arg_values(inner, get_value).iter().sum())),
        "AVERAGE" => {
            let vals = collect_arg_values(inner, get_value);
            if vals.is_empty() {
                return Some("#DIV/0!".into());
            }
            Some(format_num(vals.iter().sum::<f64>() / vals.len() as f64))
        }
        "MIN" => {
            let min = collect_arg_values(inner, get_value)
                .into_iter()
                .fold(f64::INFINITY, f64::min);
            Some(if min.is_infinite() { "0".into() } else { format_num(min) })
        }
        "MAX" => {
            let max = collect_arg_values(inner, get_value)
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max);
            Some(if max.is_infinite() { "0".into() } else { format_num(max) })
        }
        "COUNT" => Some(collect_arg_values(inner, get_value).len().to_string()),
        "IF" => {
            // Split on top-level commas only.
            let args = split_args(inner);
            if args.len() != 3 {
                return Some("#ARG!".into());
            }
            let cond = eval_to_string(args[0].trim(), get_value);
            let non_zero = cond.parse::<f64>().map(|n| n != 0.0).unwrap_or(!cond.is_empty());
            Some(eval_to_string(args[if non_zero { 1 } else { 2 }].trim(), get_value))
        }
        _ => Some("#NAME?".into()),
    }
}

/// Values contributed by a function's argument list. A range arg (`A1:B3`)
/// expands to its numeric cells; every other comma-separated arg is
/// evaluated as an expression (cell ref, number, or arithmetic) and
/// contributes its numeric value — so `SUM(3+4)` and `SUM(A1, A2, 5)` work.
fn collect_arg_values(args: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Vec<f64> {
    let mut nums = Vec::new();
    for arg in split_args(args) {
        let arg = arg.trim();
        if arg.is_empty() {
            continue;
        }
        if arg.contains(':') {
            // A range, possibly sheet-qualified (`[id]!A1:A3`).
            let (sheet, rest) = split_sheet_qualifier(arg);
            for (r, c) in expand_range(&rest) {
                if let Some(raw) = get_value(sheet.as_deref(), r, c) {
                    if let Ok(n) = raw.trim().parse::<f64>() {
                        nums.push(n);
                    }
                }
            }
        } else if let Some(n) = eval_number(arg, get_value) {
            // Single cells (incl. cross-sheet), numbers and arithmetic go
            // through the number parser, which handles `[id]!A1` itself.
            nums.push(n);
        }
    }
    nums
}

// ── Arithmetic expression parser (recursive descent) ──────────────────
// add    := mul (('+' | '-') mul)*
// mul    := factor (('*' | '/') factor)*
// factor := number | cellref | NAME(args) | '(' add ')' | ('+' | '-') factor
// Returns None on any parse error or non-numeric operand, so the caller can
// fall back to string handling.

fn eval_number(expr: &str, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
    let chars: Vec<char> = expr.chars().collect();
    let mut p = 0usize;
    let v = parse_add(&chars, &mut p, gv)?;
    skip_ws(&chars, &mut p);
    if p == chars.len() { Some(v) } else { None } // reject trailing junk
}

fn skip_ws(c: &[char], p: &mut usize) {
    while *p < c.len() && c[*p].is_whitespace() {
        *p += 1;
    }
}

fn parse_add(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
    let mut v = parse_mul(c, p, gv)?;
    loop {
        skip_ws(c, p);
        match c.get(*p) {
            Some('+') => { *p += 1; v += parse_mul(c, p, gv)?; }
            Some('-') => { *p += 1; v -= parse_mul(c, p, gv)?; }
            _ => break,
        }
    }
    Some(v)
}

fn parse_mul(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
    let mut v = parse_factor(c, p, gv)?;
    loop {
        skip_ws(c, p);
        match c.get(*p) {
            Some('*') => { *p += 1; v *= parse_factor(c, p, gv)?; }
            Some('/') => {
                *p += 1;
                let d = parse_factor(c, p, gv)?;
                if d == 0.0 {
                    return None; // #DIV/0! surfaces as a non-numeric result
                }
                v /= d;
            }
            _ => break,
        }
    }
    Some(v)
}

fn parse_factor(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
    skip_ws(c, p);
    match c.get(*p)? {
        '(' => {
            *p += 1;
            let v = parse_add(c, p, gv)?;
            skip_ws(c, p);
            if c.get(*p) != Some(&')') {
                return None;
            }
            *p += 1;
            Some(v)
        }
        '-' => { *p += 1; Some(-parse_factor(c, p, gv)?) }
        '+' => { *p += 1; parse_factor(c, p, gv) }
        '[' => parse_bracket_ref(c, p, gv),
        ch if ch.is_ascii_alphabetic() => parse_ident(c, p, gv),
        ch if ch.is_ascii_digit() || *ch == '.' => {
            let start = *p;
            while *p < c.len() && (c[*p].is_ascii_digit() || c[*p] == '.') {
                *p += 1;
            }
            c[start..*p].iter().collect::<String>().parse::<f64>().ok()
        }
        _ => None,
    }
}

/// A leading alphabetic run is a function call `NAME(...)` or a plain cell
/// reference `A1`. Cross-sheet references use the bracket form `[id]!A1`
/// (see `parse_bracket_ref`), not a bare `name!` qualifier.
fn parse_ident(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
    let start = *p;
    while *p < c.len() && c[*p].is_ascii_alphabetic() {
        *p += 1;
    }
    if c.get(*p) == Some(&'(') {
        // Function call — capture through the matching ')' and reuse the
        // string evaluator (handles SUM/AVERAGE/… nested in arithmetic).
        *p += 1;
        let mut depth = 1usize;
        while *p < c.len() && depth > 0 {
            match c[*p] {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            *p += 1;
        }
        if depth != 0 {
            return None;
        }
        let call: String = c[start..*p].iter().collect();
        return eval_to_string(&call, gv).trim().parse::<f64>().ok();
    }

    // Consume any trailing digits — the row part of a cell ref (`A1`).
    let digits_start = *p;
    while *p < c.len() && c[*p].is_ascii_digit() {
        *p += 1;
    }

    // Plain same-sheet cell reference.
    if *p == digits_start {
        return None; // letters with no row digits — not a cell ref
    }
    let refstr: String = c[start..*p].iter().collect();
    let (row, col) = parse_cell_ref(&refstr)?;
    cell_num(gv, None, row, col)
}

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

/// Resolve a cell reference to a number for arithmetic: empty / missing → 0,
/// non-numeric text → `None` (makes the surrounding expression non-numeric).
fn cell_num(
    gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>,
    sheet: Option<&str>,
    row: u32,
    col: u32,
) -> Option<f64> {
    match gv(sheet, row, col) {
        Some(val) => {
            let t = val.trim();
            if t.is_empty() { Some(0.0) } else { t.parse::<f64>().ok() }
        }
        None => Some(0.0),
    }
}

fn parens_balanced(s: &str) -> bool {
    let mut depth = 0i32;
    for ch in s.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

/// Expand a range string (`A1:B3` or `A1`) into `(row, col)` pairs.
// Bounds for whole-column (`A:A`) and whole-row (`1:1`) references. The UI
// grid is 26 columns (A–Z) × 50 rows; we scan a little past the visible rows
// so column sums still pick up anything entered lower down. Empty cells
// contribute nothing, so an over-estimate is harmless (only affects how far
// we iterate, never the result).
const MAX_ROWS: u32 = 1000;
const MAX_COLS: u32 = 26;

/// A bare column label (`A`..`Z`) → 0-based column index. `None` if the
/// string isn't a single uppercase letter (so `A1` is not a column).
fn parse_col_only(s: &str) -> Option<u32> {
    let mut chars = s.chars();
    let c = chars.next()?;
    if chars.next().is_some() || !c.is_ascii_uppercase() {
        return None;
    }
    Some(c as u32 - 'A' as u32)
}

/// A bare 1-based row number (`1`, `42`) → 0-based row index. `None` if the
/// string isn't all digits.
fn parse_row_only(s: &str) -> Option<u32> {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    s.parse::<u32>().ok()?.checked_sub(1)
}

fn expand_range(range: &str) -> Vec<(u32, u32)> {
    let parts: Vec<&str> = range.split(':').collect();
    match parts.as_slice() {
        [single] => parse_cell_ref(single.trim())
            .map(|rc| vec![rc])
            .unwrap_or_default(),
        [start, end] => {
            let (s, e) = (start.trim(), end.trim());
            // Whole-column range: `A:A`, `A:C` → every row of those columns.
            if let (Some(c1), Some(c2)) = (parse_col_only(s), parse_col_only(e)) {
                let mut cells = Vec::new();
                for c in c1.min(c2)..=c1.max(c2) {
                    for r in 0..MAX_ROWS {
                        cells.push((r, c));
                    }
                }
                return cells;
            }
            // Whole-row range: `1:1`, `2:5` → every column of those rows.
            if let (Some(r1), Some(r2)) = (parse_row_only(s), parse_row_only(e)) {
                let mut cells = Vec::new();
                for r in r1.min(r2)..=r1.max(r2) {
                    for c in 0..MAX_COLS {
                        cells.push((r, c));
                    }
                }
                return cells;
            }
            // Ordinary cell range: `A1:C3`.
            match (parse_cell_ref(s), parse_cell_ref(e)) {
                (Some((r1, c1)), Some((r2, c2))) => {
                    let mut cells = Vec::new();
                    for r in r1.min(r2)..=r1.max(r2) {
                        for c in c1.min(c2)..=c1.max(c2) {
                            cells.push((r, c));
                        }
                    }
                    cells
                }
                _ => vec![],
            }
        }
        _ => vec![],
    }
}

/// Every cell reference a formula syntactically contains, as absolute
/// `(sheet_id, row, col)` targets (`home_sheet` for un-qualified refs). Ranges
/// are expanded to member cells; string literals and function names are ignored.
/// Over-approximates (captures all branches) — this is what makes the dependency
/// graph conservative and the topological order valid for any runtime branch.
pub fn precedents(formula: &str, home_sheet: &str) -> Vec<(String, u32, u32)> {
    let trimmed = formula.trim();
    if !trimmed.starts_with('=') {
        return Vec::new();
    }
    // Drop '=' and all '$' anchors (they never change which cell is
    // referenced — an absolute ref `$B$2` targets the same cell as `B2`).
    let body = &trimmed[1..];
    let chars: Vec<char> = body.chars().filter(|&c| c != '$').collect();
    let mut out: Vec<(String, u32, u32)> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        // String literal — copy through the closing quote, capturing nothing.
        if ch == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
            continue;
        }
        // Cross-sheet qualifier [id]! followed by a ref or range.
        if ch == '[' {
            if let Some(end) = chars[i + 1..].iter().position(|&c| c == ']') {
                let id: String = chars[i + 1..i + 1 + end].iter().collect();
                let mut j = i + 1 + end + 1; // past ']'
                if chars.get(j) == Some(&'!') {
                    j += 1;
                    let (unit, next) = read_ref_unit(&chars, j);
                    for (r, c) in expand_range(&unit) {
                        out.push((id.clone(), r, c));
                    }
                    i = next.max(j);
                    continue;
                }
            }
            i += 1;
            continue;
        }
        // A letter run followed immediately by '(' is a function name — skip the
        // name only; its arguments are scanned by the outer loop.
        if ch.is_ascii_uppercase() || ch.is_ascii_lowercase() {
            let mut k = i;
            while k < chars.len() && chars[k].is_ascii_alphabetic() {
                k += 1;
            }
            if chars.get(k) == Some(&'(') {
                i = k; // leave '(' for the loop; args scanned next
                continue;
            }
            // Otherwise read a ref-or-range unit starting at i.
            if ch.is_ascii_uppercase() {
                let (unit, next) = read_ref_unit(&chars, i);
                if next > i {
                    for (r, c) in expand_range(&unit) {
                        out.push((home_sheet.to_string(), r, c));
                    }
                    i = next;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        // A digit run may open a whole-row range (`1:1`); a lone number is a
        // literal and captures nothing.
        if ch.is_ascii_digit() {
            let (unit, next) = read_ref_unit(&chars, i);
            if unit.contains(':') {
                for (r, c) in expand_range(&unit) {
                    out.push((home_sheet.to_string(), r, c));
                }
            }
            i = next.max(i + 1);
            continue;
        }
        i += 1;
    }
    out
}

/// Read a ref-or-range token starting at `start`: a run of uppercase letters
/// and/or digits, optionally `':'` and a second such run. Returns the token
/// string (e.g. `"A1"`, `"A1:B3"`, `"A:A"`, `"1:1"`) and the index just past it.
fn read_ref_unit(chars: &[char], start: usize) -> (String, usize) {
    let read_atom = |mut p: usize| -> usize {
        while p < chars.len() && chars[p].is_ascii_uppercase() {
            p += 1;
        }
        while p < chars.len() && chars[p].is_ascii_digit() {
            p += 1;
        }
        p
    };
    let mut end = read_atom(start);
    if chars.get(end) == Some(&':') {
        end = read_atom(end + 1);
    }
    (chars[start..end].iter().collect(), end)
}

/// Parse a cell reference like `A1` → (row=0, col=0).
/// Columns are A=0, B=1, …; rows are 1-indexed in the formula.
fn parse_cell_ref(r: &str) -> Option<(u32, u32)> {
    let r = r.trim();
    let mut chars = r.chars();
    let col_char = chars.next()?;
    if !col_char.is_ascii_uppercase() {
        return None;
    }
    let col = col_char as u32 - 'A' as u32;
    let row_str: String = chars.collect();
    let row_1: u32 = row_str.parse().ok()?;
    let row = row_1.checked_sub(1)?;
    Some((row, col))
}

/// Split a comma-separated argument string respecting nested parentheses.
fn split_args(s: &str) -> Vec<&str> {
    let mut args = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                args.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    args.push(&s[start..]);
    args
}

fn format_num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precedents_single_and_range() {
        // A range expands to every member cell; a lone ref is one cell.
        let mut p = precedents("=A1+B2", "s1");
        p.sort();
        assert_eq!(p, vec![("s1".into(), 0, 0), ("s1".into(), 1, 1)]);

        let mut r = precedents("=SUM(A1:A3)", "s1");
        r.sort();
        assert_eq!(
            r,
            vec![("s1".into(), 0, 0), ("s1".into(), 1, 0), ("s1".into(), 2, 0)]
        );
    }

    #[test]
    fn precedents_ignores_function_names_and_strings() {
        // SUM/IF are names, not refs; "A1" inside a string literal is text.
        let mut p = precedents("=IF(A1, \"B2\", C3)", "s1");
        p.sort();
        assert_eq!(p, vec![("s1".into(), 0, 0), ("s1".into(), 2, 2)]); // A1 and C3 only
    }

    #[test]
    fn precedents_cross_sheet_and_absolute() {
        // [id]! qualifies the sheet; $ anchors are irrelevant to dependency.
        let mut p = precedents("=[data]!A1 + $B$2", "s1");
        p.sort();
        assert_eq!(p, vec![("data".into(), 0, 0), ("s1".into(), 1, 1)]);
    }

    #[test]
    fn precedents_non_formula_is_empty() {
        assert!(precedents("42", "s1").is_empty());
        assert!(precedents("hello", "s1").is_empty());
    }

    #[test]
    fn error_tokens_propagate_verbatim() {
        let gv = |_s: Option<&str>, _r: u32, _c: u32| None;
        // A formula whose reference shifted out of range is stored as `=#REF!`;
        // it must display `#REF!`, not be misparsed (trailing `!` → sheet
        // qualifier) and collapse to `#VALUE!`.
        assert_eq!(evaluate("=#REF!", &gv), "#REF!");
        assert_eq!(evaluate("=#DIV/0!", &gv), "#DIV/0!");
        assert_eq!(evaluate("=#NAME?", &gv), "#NAME?");
    }

    #[test]
    fn dollar_preserved_inside_string_literals() {
        let gv = |_s: Option<&str>, _r: u32, _c: u32| None;
        // `$` is stripped only as an absolute-ref anchor — never inside a string.
        assert_eq!(evaluate("=\"$5\"", &gv), "$5");
        assert_eq!(evaluate("=\"Total $\"", &gv), "Total $");
        // And `$` outside strings is still stripped, so absolute refs still work.
        let gv1 = |_s: Option<&str>, _r: u32, _c: u32| Some("9".to_string());
        assert_eq!(evaluate("=$A$1", &gv1), "9");
    }

    #[test]
    fn formula_arithmetic_literals() {
        let gv = |_s: Option<&str>, _r: u32, _c: u32| None;
        assert_eq!(evaluate("=3+4", &gv), "7");
        assert_eq!(evaluate("=SUM(3+4)", &gv), "7");
        assert_eq!(evaluate("=10-4", &gv), "6");
        assert_eq!(evaluate("=2*3", &gv), "6");
        assert_eq!(evaluate("=8/2", &gv), "4");
        assert_eq!(evaluate("=(1+2)*3", &gv), "9");
        assert_eq!(evaluate("=2+3*4", &gv), "14"); // precedence
    }

    #[test]
    fn formula_whole_column_and_row_refs() {
        // Column A (col 0): A1=1, A2=2, A3=3.  Row 5 (index 4): B5=10, C5=20.
        let gv = |_s: Option<&str>, r: u32, c: u32| match (r, c) {
            (0, 0) => Some("1".to_string()),
            (1, 0) => Some("2".to_string()),
            (2, 0) => Some("3".to_string()),
            (4, 1) => Some("10".to_string()),
            (4, 2) => Some("20".to_string()),
            _ => None,
        };
        // Whole-column reference A:A
        assert_eq!(evaluate("=SUM(A:A)", &gv), "6");
        assert_eq!(evaluate("=COUNT(A:A)", &gv), "3");
        assert_eq!(evaluate("=AVERAGE(A:A)", &gv), "2");
        assert_eq!(evaluate("=MAX(A:A)", &gv), "3");
        assert_eq!(evaluate("=MIN(A:A)", &gv), "1");
        // Whole-row reference 5:5 (1-based → row index 4)
        assert_eq!(evaluate("=SUM(5:5)", &gv), "30");
        assert_eq!(evaluate("=COUNT(5:5)", &gv), "2");
        // Multi-column range: col A (1+2+3=6) + col B (B5=10) = 16
        assert_eq!(evaluate("=SUM(A:B)", &gv), "16");
    }

    #[test]
    fn formula_arithmetic_with_cells_and_args() {
        // A1 = 10 (row 0, col 0), A2 = 20 (row 1, col 0)
        let gv = |_s: Option<&str>, r: u32, c: u32| match (r, c) {
            (0, 0) => Some("10".to_string()),
            (1, 0) => Some("20".to_string()),
            _ => None,
        };
        assert_eq!(evaluate("=A1+A2", &gv), "30");
        assert_eq!(evaluate("=A1*2", &gv), "20");
        assert_eq!(evaluate("=SUM(A1, A2, 5)", &gv), "35"); // comma args
        assert_eq!(evaluate("=SUM(A1:A2)", &gv), "30"); // range still works
        assert_eq!(evaluate("=SUM(A1:A2)+100", &gv), "130"); // function in arithmetic
    }
}
