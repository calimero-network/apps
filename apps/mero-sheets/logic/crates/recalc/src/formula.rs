//! The formula engine: text → tokens → expression tree → typed value.
//!
//! One implementation serves the node (linked into the contract) and the
//! browser (through `recalc-wasm`), so both compute the same value for the
//! same workbook. Cell values cross the boundary as display strings; inside the
//! engine a value is typed ([`Value`]), so a comparison yields a boolean, an
//! error stays an error through every operator and function, and a condition
//! can never mistake the text `#VALUE!` for "true".
//!
//! [`CATALOG`] lists every function the evaluator implements, with the syntax
//! and example the app shows in its function help. The contract serves that
//! list and a test evaluates every example, so the help cannot drift from the
//! engine.

use std::cmp::Ordering::{self, Equal, Greater, Less};
use std::collections::BTreeMap;

/// Rows a whole-column reference (`A:A`) spans.
pub const MAX_ROWS: u32 = 1000;
/// Columns a whole-row reference (`1:1`) spans, which is also the widest
/// column a reference may name: `A`..`ZZ`.
pub const MAX_COLS: u32 = 702;
/// The highest row a reference may name.
const MAX_REF_ROW: u32 = 1_048_576;
/// Nesting a formula may use before it is refused; bounds the parser's
/// recursion, which runs on the contract's small wasm stack.
const MAX_DEPTH: usize = 64;
/// Date serial of 1970-01-01. Serials count days from 1899-12-30, as in every
/// other spreadsheet, so a pasted date means the same day here.
const EPOCH: i64 = 25569;

/// What a formula can see besides cells.
#[derive(Clone, Debug, Default)]
pub struct Env {
    /// Wall-clock time, in milliseconds since the Unix epoch, for `NOW()` and
    /// `TODAY()`.
    pub now_ms: u64,
    /// Named ranges: upper-case name → the reference it stands for, written as
    /// a formula would write it (`B2:B20`, `[sheet-id]!A1:A9`).
    pub names: BTreeMap<String, String>,
}

/// Evaluate a formula with no named ranges and the clock at the epoch.
///
/// `formula` should start with `=`. `get_value(sheet, row, col)` returns a
/// cell's current computed value: `sheet` is `None` for a reference on the
/// formula's own sheet and `Some(id)` for `[id]!A1`. Rows and columns are
/// 0-based; `A1` is row 0, column 0.
pub fn evaluate(
    formula: &str,
    get_value: impl Fn(Option<&str>, u32, u32) -> Option<String>,
) -> String {
    evaluate_with(formula, &Env::default(), get_value)
}

/// Evaluate a formula against `env`. See [`evaluate`].
pub fn evaluate_with(
    formula: &str,
    env: &Env,
    get_value: impl Fn(Option<&str>, u32, u32) -> Option<String>,
) -> String {
    let body = formula.trim();
    let body = body.strip_prefix('=').unwrap_or(body);
    if body.trim().is_empty() {
        return String::new();
    }
    match parse(body) {
        Ok(expr) => Ctx {
            get: &get_value,
            env,
        }
        .eval(&expr)
        .display(),
        Err(()) => E::Parse.as_str().to_string(),
    }
}

/// Every cell a formula reads, as `(sheet_id, row, col)`, with `home_sheet`
/// for unqualified references. Ranges expand to their cells. Every branch of
/// an `IF` is included, so the dependency order is valid whichever branch runs.
pub fn precedents(formula: &str, home_sheet: &str) -> Vec<(String, u32, u32)> {
    precedents_with(formula, home_sheet, &BTreeMap::new())
}

/// [`precedents`], also following named ranges through `names`.
pub fn precedents_with(
    formula: &str,
    home_sheet: &str,
    names: &BTreeMap<String, String>,
) -> Vec<(String, u32, u32)> {
    let Some(body) = formula.trim().strip_prefix('=') else {
        return Vec::new();
    };
    let Ok(expr) = parse(body) else {
        return Vec::new();
    };
    let mut refs = Vec::new();
    collect_refs(&expr, names, &mut refs);
    let mut out = Vec::new();
    for r in refs {
        let sheet = r.sheet.as_deref().unwrap_or(home_sheet);
        for row in r.r1..=r.r2 {
            for col in r.c1..=r.c2 {
                out.push((sheet.to_string(), row, col));
            }
        }
    }
    out
}

fn collect_refs(e: &Expr, names: &BTreeMap<String, String>, out: &mut Vec<RefExpr>) {
    match e {
        Expr::Ref(r) => out.push(r.clone()),
        Expr::Name(n) => out.extend(name_ref(names, n)),
        Expr::Call(_, args) => args.iter().for_each(|a| collect_refs(a, names, out)),
        Expr::Neg(x) | Expr::Percent(x) => collect_refs(x, names, out),
        Expr::Bin(_, a, b) => {
            collect_refs(a, names, out);
            collect_refs(b, names, out);
        }
        Expr::Num(_) | Expr::Str(_) | Expr::Bool(_) | Expr::Err(_) | Expr::Blank => {}
    }
}

/// The reference a named range stands for, if the name is defined and its
/// target is a reference.
fn name_ref(names: &BTreeMap<String, String>, name: &str) -> Option<RefExpr> {
    let target = names.get(name)?;
    let target = target.trim();
    match parse(target.strip_prefix('=').unwrap_or(target)) {
        Ok(Expr::Ref(r)) => Some(r),
        _ => None,
    }
}

/// `A` → 0, `Z` → 25, `AA` → 26. `None` past [`MAX_COLS`] or for anything
/// that is not letters.
pub fn col_index(label: &str) -> Option<u32> {
    if label.is_empty() || label.len() > 3 || !label.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let n = label.chars().fold(0u32, |n, c| {
        n * 26 + (c.to_ascii_uppercase() as u32 - 'A' as u32 + 1)
    });
    (n <= MAX_COLS).then(|| n - 1)
}

/// 0 → `A`, 25 → `Z`, 26 → `AA`.
pub fn col_label(index: u32) -> String {
    let mut n = index + 1;
    let mut out = Vec::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        out.push(char::from(b'A' + rem as u8));
        n = (n - 1) / 26;
    }
    out.iter().rev().collect()
}

/// A number as a cell shows it: at most 15 significant digits, so `0.1+0.2`
/// is `0.3`, and scientific notation outside 1e-10..1e15.
pub fn format_num(n: f64) -> String {
    if !n.is_finite() {
        return E::Num.as_str().to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    // The leading digit's exponent, from Rust's own formatter rather than
    // `log10`, whose last bit can differ between the node and the browser.
    let exp: i32 = format!("{:e}", n.abs())
        .split_once('e')
        .and_then(|(_, e)| e.parse().ok())
        .unwrap_or(0);
    if !(-10..15).contains(&exp) {
        let s = format!("{n:.14e}");
        let (mantissa, e) = s.split_once('e').unwrap_or((&s, "0"));
        let e: i32 = e.parse().unwrap_or(0);
        let sign = if e < 0 { '-' } else { '+' };
        return format!("{}E{sign}{:02}", trim_zeros(mantissa), e.abs());
    }
    let decimals = (14 - exp).max(0) as usize;
    trim_zeros(&format!("{n:.decimals$}")).to_string()
}

fn trim_zeros(s: &str) -> &str {
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.')
    } else {
        s
    }
}

// ── Errors ──────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ErrCode {
    Div0,
    Val,
    Ref,
    Name,
    Num,
    Na,
    Null,
    Cycle,
    Parse,
}
type E = ErrCode;

impl ErrCode {
    const ALL: [ErrCode; 9] = [
        E::Div0,
        E::Val,
        E::Ref,
        E::Name,
        E::Num,
        E::Na,
        E::Null,
        E::Cycle,
        E::Parse,
    ];

    fn as_str(self) -> &'static str {
        match self {
            E::Div0 => "#DIV/0!",
            E::Val => "#VALUE!",
            E::Ref => "#REF!",
            E::Name => "#NAME?",
            E::Num => "#NUM!",
            E::Na => "#N/A",
            E::Null => "#NULL!",
            E::Cycle => "#CYCLE!",
            E::Parse => "#ERROR!",
        }
    }

    fn parse(s: &str) -> Option<ErrCode> {
        Self::ALL.into_iter().find(|e| e.as_str() == s)
    }
}

// ── Tokens ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    /// A name, a function name, a cell (`B12`) or a column (`B`).
    Word(String),
    /// `[sheet-id]!`, which qualifies the reference after it.
    Sheet(String),
    Err(ErrCode),
    Op(Op),
    LParen,
    RParen,
    Comma,
    Colon,
    Percent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Cat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    /// Left and right binding power. Comparison binds loosest, then `&`, then
    /// `+ -`, `* /`, and `^`; all are left-associative, as in Excel.
    fn binding(self) -> (u8, u8) {
        match self {
            Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => (1, 2),
            Op::Cat => (3, 4),
            Op::Add | Op::Sub => (5, 6),
            Op::Mul | Op::Div => (7, 8),
            Op::Pow => (9, 10),
        }
    }
}

/// Binding power of a unary sign's operand: tighter than every binary
/// operator, so `-2^2` is 4 as in Excel.
const UNARY: u8 = 11;

fn tokenize(src: &str) -> Result<Vec<Tok>, ()> {
    let c: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        match ch {
            // `$` anchors a reference for fill and copy; it never changes
            // which cell is read, so it is dropped outside string literals.
            '$' => i += 1,
            _ if ch.is_whitespace() => i += 1,
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match c.get(i) {
                        None => return Err(()),
                        Some('"') if c.get(i + 1) == Some(&'"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('"') => {
                            i += 1;
                            break;
                        }
                        Some(&x) => {
                            s.push(x);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Str(s));
            }
            '[' => {
                let end = i + 1 + c[i + 1..].iter().position(|&x| x == ']').ok_or(())?;
                if c.get(end + 1) != Some(&'!') {
                    return Err(());
                }
                out.push(Tok::Sheet(c[i + 1..end].iter().collect()));
                i = end + 2;
            }
            '#' => {
                let rest: String = c[i..].iter().collect::<String>().to_ascii_uppercase();
                let code = ErrCode::ALL
                    .into_iter()
                    .find(|e| rest.starts_with(e.as_str()))
                    .ok_or(())?;
                out.push(Tok::Err(code));
                i += code.as_str().len();
            }
            '0'..='9' | '.' => {
                let start = i;
                while i < c.len() && (c[i].is_ascii_digit() || c[i] == '.') {
                    i += 1;
                }
                if matches!(c.get(i), Some('e' | 'E')) {
                    let mut j = i + 1;
                    if matches!(c.get(j), Some('+' | '-')) {
                        j += 1;
                    }
                    if c.get(j).is_some_and(char::is_ascii_digit) {
                        while c.get(j).is_some_and(char::is_ascii_digit) {
                            j += 1;
                        }
                        i = j;
                    }
                }
                let text: String = c[start..i].iter().collect();
                out.push(Tok::Num(text.parse().map_err(|_| ())?));
            }
            _ if ch.is_alphabetic() || ch == '_' => {
                let mut w = String::new();
                while i < c.len() && (c[i].is_alphanumeric() || matches!(c[i], '_' | '.' | '$')) {
                    if c[i] != '$' {
                        w.push(c[i]);
                    }
                    i += 1;
                }
                out.push(Tok::Word(w));
            }
            _ => {
                let (tok, len) = match (ch, c.get(i + 1)) {
                    ('(', _) => (Tok::LParen, 1),
                    (')', _) => (Tok::RParen, 1),
                    (',' | ';', _) => (Tok::Comma, 1),
                    (':', _) => (Tok::Colon, 1),
                    ('%', _) => (Tok::Percent, 1),
                    ('+', _) => (Tok::Op(Op::Add), 1),
                    ('-', _) => (Tok::Op(Op::Sub), 1),
                    ('*', _) => (Tok::Op(Op::Mul), 1),
                    ('/', _) => (Tok::Op(Op::Div), 1),
                    ('^', _) => (Tok::Op(Op::Pow), 1),
                    ('&', _) => (Tok::Op(Op::Cat), 1),
                    ('=', _) => (Tok::Op(Op::Eq), 1),
                    ('<', Some('=')) => (Tok::Op(Op::Le), 2),
                    ('<', Some('>')) => (Tok::Op(Op::Ne), 2),
                    ('<', _) => (Tok::Op(Op::Lt), 1),
                    ('>', Some('=')) => (Tok::Op(Op::Ge), 2),
                    ('>', _) => (Tok::Op(Op::Gt), 1),
                    _ => return Err(()),
                };
                out.push(tok);
                i += len;
            }
        }
    }
    Ok(out)
}

// ── Expression tree ─────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
enum Expr {
    Num(f64),
    Str(String),
    Bool(bool),
    Err(ErrCode),
    /// An argument left empty, as in `IF(A1,,2)`.
    Blank,
    Ref(RefExpr),
    Name(String),
    Call(String, Vec<Expr>),
    Neg(Box<Expr>),
    Percent(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
}

/// A rectangle of cells, corners normalised so `r1 <= r2` and `c1 <= c2`.
#[derive(Clone, Debug, PartialEq)]
struct RefExpr {
    sheet: Option<String>,
    r1: u32,
    c1: u32,
    r2: u32,
    c2: u32,
}

/// One end of a range: a cell, a whole column, or a whole row.
enum Anchor {
    Cell(u32, u32),
    Col(u32),
    Row(u32),
}

impl Anchor {
    fn from_tok(t: &Tok) -> Option<Anchor> {
        match t {
            Tok::Word(w) => {
                if let Some((r, c)) = parse_cell_word(w) {
                    Some(Anchor::Cell(r, c))
                } else {
                    col_index(w).map(Anchor::Col)
                }
            }
            Tok::Num(n) => row_number(*n).map(Anchor::Row),
            _ => None,
        }
    }
}

/// `B12` → (11, 1).
fn parse_cell_word(w: &str) -> Option<(u32, u32)> {
    let split = w.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = w.split_at(split);
    let col = col_index(letters)?;
    if !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let row: u32 = digits.parse().ok()?;
    (1..=MAX_REF_ROW).contains(&row).then(|| (row - 1, col))
}

/// A 1-based row number written as a literal (`3` in `3:5`) → 0-based.
fn row_number(n: f64) -> Option<u32> {
    (n.fract() == 0.0 && (1.0..=f64::from(MAX_REF_ROW)).contains(&n)).then(|| n as u32 - 1)
}

fn parse(src: &str) -> Result<Expr, ()> {
    let mut p = Parser {
        toks: tokenize(src)?,
        pos: 0,
        depth: 0,
    };
    let e = p.expr(0)?;
    if p.pos != p.toks.len() {
        return Err(());
    }
    Ok(e)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, t: &Tok) -> bool {
        let hit = self.peek() == Some(t);
        if hit {
            self.pos += 1;
        }
        hit
    }

    fn expr(&mut self, min_bp: u8) -> Result<Expr, ()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(());
        }
        let mut lhs = self.prefix()?;
        loop {
            match self.peek() {
                Some(Tok::Percent) => {
                    self.pos += 1;
                    lhs = Expr::Percent(Box::new(lhs));
                }
                Some(Tok::Op(op)) => {
                    let op = *op;
                    let (l, r) = op.binding();
                    if l < min_bp {
                        break;
                    }
                    self.pos += 1;
                    let rhs = self.expr(r)?;
                    lhs = Expr::Bin(op, Box::new(lhs), Box::new(rhs));
                }
                _ => break,
            }
        }
        self.depth -= 1;
        Ok(lhs)
    }

    fn prefix(&mut self) -> Result<Expr, ()> {
        match self.next().ok_or(())? {
            Tok::Num(_) if self.peek() == Some(&Tok::Colon) => {
                self.pos -= 1;
                self.reference(None)
            }
            Tok::Num(n) => Ok(Expr::Num(n)),
            Tok::Str(s) => Ok(Expr::Str(s)),
            Tok::Err(e) => Ok(Expr::Err(e)),
            Tok::Sheet(id) => self.reference(Some(id)),
            Tok::Word(w) if self.eat(&Tok::LParen) => {
                let mut args = Vec::new();
                if !self.eat(&Tok::RParen) {
                    loop {
                        if matches!(self.peek(), Some(Tok::Comma | Tok::RParen)) {
                            args.push(Expr::Blank);
                        } else {
                            args.push(self.expr(0)?);
                        }
                        if self.eat(&Tok::RParen) {
                            break;
                        }
                        if !self.eat(&Tok::Comma) {
                            return Err(());
                        }
                    }
                }
                Ok(Expr::Call(w.to_ascii_uppercase(), args))
            }
            Tok::Word(w) if w.eq_ignore_ascii_case("TRUE") => Ok(Expr::Bool(true)),
            Tok::Word(w) if w.eq_ignore_ascii_case("FALSE") => Ok(Expr::Bool(false)),
            Tok::Word(_) => {
                self.pos -= 1;
                self.reference(None)
            }
            Tok::LParen => {
                let e = self.expr(0)?;
                if !self.eat(&Tok::RParen) {
                    return Err(());
                }
                Ok(e)
            }
            Tok::Op(Op::Sub) => Ok(Expr::Neg(Box::new(self.expr(UNARY)?))),
            Tok::Op(Op::Add) => self.expr(UNARY),
            _ => Err(()),
        }
    }

    /// A cell, a range, or (unqualified) a named range.
    fn reference(&mut self, sheet: Option<String>) -> Result<Expr, ()> {
        let first = self.next().ok_or(())?;
        let start = Anchor::from_tok(&first);
        if self.peek() == Some(&Tok::Colon) {
            let end = self.toks.get(self.pos + 1).and_then(Anchor::from_tok);
            let (r1, c1, r2, c2) = match (start, end) {
                (Some(Anchor::Cell(r1, c1)), Some(Anchor::Cell(r2, c2))) => (r1, c1, r2, c2),
                (Some(Anchor::Col(c1)), Some(Anchor::Col(c2))) => (0, c1, MAX_ROWS - 1, c2),
                (Some(Anchor::Row(r1)), Some(Anchor::Row(r2))) => (r1, 0, r2, MAX_COLS - 1),
                _ => return Err(()),
            };
            self.pos += 2;
            return Ok(Expr::Ref(RefExpr {
                sheet,
                r1: r1.min(r2),
                c1: c1.min(c2),
                r2: r1.max(r2),
                c2: c1.max(c2),
            }));
        }
        match (start, first) {
            (Some(Anchor::Cell(r, c)), _) => Ok(Expr::Ref(RefExpr {
                sheet,
                r1: r,
                c1: c,
                r2: r,
                c2: c,
            })),
            (_, Tok::Word(w)) if sheet.is_none() => Ok(Expr::Name(w.to_ascii_uppercase())),
            _ => Err(()),
        }
    }
}

// ── Values ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
enum Value {
    Num(f64),
    Str(String),
    Bool(bool),
    Err(ErrCode),
    Empty,
    Grid(Grid),
}

/// The cells of a range, row-major.
#[derive(Clone, Debug, PartialEq)]
struct Grid {
    rows: usize,
    cols: usize,
    cells: Vec<Value>,
}

impl Grid {
    fn get(&self, r: usize, c: usize) -> &Value {
        &self.cells[r * self.cols + c]
    }

    fn row(&self, r: usize) -> Value {
        Value::Grid(Grid {
            rows: 1,
            cols: self.cols,
            cells: self.cells[r * self.cols..(r + 1) * self.cols].to_vec(),
        })
    }

    fn col(&self, c: usize) -> Value {
        Value::Grid(Grid {
            rows: self.rows,
            cols: 1,
            cells: (0..self.rows).map(|r| self.get(r, c).clone()).collect(),
        })
    }
}

fn parse_number(t: &str) -> Option<f64> {
    t.parse::<f64>().ok().filter(|n| n.is_finite())
}

fn bool_text(b: bool) -> &'static str {
    if b {
        "TRUE"
    } else {
        "FALSE"
    }
}

impl Value {
    /// A cell's stored or computed string, typed.
    fn from_cell(raw: Option<String>) -> Value {
        let Some(s) = raw else {
            return Value::Empty;
        };
        let t = s.trim();
        if t.is_empty() {
            Value::Empty
        } else if let Some(e) = ErrCode::parse(t) {
            Value::Err(e)
        } else if t.eq_ignore_ascii_case("TRUE") {
            Value::Bool(true)
        } else if t.eq_ignore_ascii_case("FALSE") {
            Value::Bool(false)
        } else if let Some(n) = parse_number(t) {
            Value::Num(n)
        } else {
            Value::Str(s)
        }
    }

    /// A single value: a one-cell range becomes its cell, a larger one
    /// `#VALUE!`.
    fn scalar(self) -> Value {
        match self {
            Value::Grid(g) if g.cells.len() == 1 => {
                g.cells.into_iter().next().unwrap_or(Value::Empty)
            }
            Value::Grid(_) => Value::Err(E::Val),
            v => v,
        }
    }

    fn checked(self) -> Result<Value, ErrCode> {
        match self {
            Value::Err(e) => Err(e),
            v => Ok(v),
        }
    }

    fn display(self) -> String {
        match self.scalar() {
            Value::Num(n) => format_num(n),
            Value::Str(s) => s,
            Value::Bool(b) => bool_text(b).to_string(),
            Value::Err(e) => e.as_str().to_string(),
            // An empty cell read by a formula shows as zero.
            Value::Empty => "0".to_string(),
            Value::Grid(_) => E::Val.as_str().to_string(),
        }
    }

    fn num(&self) -> Result<f64, ErrCode> {
        match self {
            Value::Num(n) => Ok(*n),
            Value::Bool(b) => Ok(f64::from(u8::from(*b))),
            Value::Empty => Ok(0.0),
            Value::Str(s) => parse_number(s.trim()).ok_or(E::Val),
            Value::Err(e) => Err(*e),
            Value::Grid(_) => Err(E::Val),
        }
    }

    fn text(&self) -> Result<String, ErrCode> {
        match self {
            Value::Num(n) => Ok(format_num(*n)),
            Value::Str(s) => Ok(s.clone()),
            Value::Bool(b) => Ok(bool_text(*b).to_string()),
            Value::Empty => Ok(String::new()),
            Value::Err(e) => Err(*e),
            Value::Grid(_) => Err(E::Val),
        }
    }

    fn truthy(&self) -> Result<bool, ErrCode> {
        match self {
            Value::Num(n) => Ok(*n != 0.0),
            Value::Bool(b) => Ok(*b),
            Value::Empty => Ok(false),
            Value::Str(s) if s.eq_ignore_ascii_case("TRUE") => Ok(true),
            Value::Str(s) if s.eq_ignore_ascii_case("FALSE") => Ok(false),
            Value::Str(_) | Value::Grid(_) => Err(E::Val),
            Value::Err(e) => Err(*e),
        }
    }
}

fn same_kind(a: &Value, b: &Value) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b)
}

/// Spreadsheet ordering: numbers before text before logicals, text compared
/// case-insensitively, and an empty cell equal to the other side's zero.
fn compare(a: &Value, b: &Value) -> Ordering {
    let zero = |other: &Value| match other {
        Value::Str(_) => Value::Str(String::new()),
        Value::Bool(_) => Value::Bool(false),
        _ => Value::Num(0.0),
    };
    let (a, b) = match (a, b) {
        (Value::Empty, o) => (zero(o), o.clone()),
        (o, Value::Empty) => (o.clone(), zero(o)),
        _ => (a.clone(), b.clone()),
    };
    let rank = |v: &Value| match v {
        Value::Num(_) => 0,
        Value::Str(_) => 1,
        _ => 2,
    };
    match (&a, &b) {
        (Value::Num(x), Value::Num(y)) => x.partial_cmp(y).unwrap_or(Equal),
        (Value::Str(x), Value::Str(y)) => x.to_lowercase().cmp(&y.to_lowercase()),
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        _ => rank(&a).cmp(&rank(&b)),
    }
}

/// Whether a comparison operator holds for an ordering.
fn holds(op: Op, o: Ordering) -> bool {
    match op {
        Op::Eq => o == Equal,
        Op::Ne => o != Equal,
        Op::Lt => o == Less,
        Op::Le => o != Greater,
        Op::Gt => o == Greater,
        Op::Ge => o != Less,
        _ => false,
    }
}

fn number(n: f64) -> Result<Value, ErrCode> {
    if n.is_finite() {
        Ok(Value::Num(n))
    } else {
        Err(E::Num)
    }
}

fn power(base: f64, exp: f64) -> Result<f64, ErrCode> {
    if base == 0.0 && exp == 0.0 {
        return Err(E::Num);
    }
    let r = libm::pow(base, exp);
    if r.is_finite() {
        Ok(r)
    } else if base == 0.0 {
        Err(E::Div0)
    } else {
        Err(E::Num)
    }
}

/// A 1-based position argument.
fn index(n: f64) -> Result<usize, ErrCode> {
    if n >= 1.0 {
        Ok(n as usize)
    } else {
        Err(E::Val)
    }
}

/// A whole-number argument small enough to do date arithmetic on.
fn int_arg(n: f64) -> Result<i64, ErrCode> {
    if n.abs() < 1e9 {
        Ok(n.trunc() as i64)
    } else {
        Err(E::Num)
    }
}

/// Nudge a value that binary floating point left a hair off a whole or half
/// number back onto it, so `ROUND(2.675, 2)` is 2.68 and `INT(0.1*3*10)` is 3,
/// as a spreadsheet user reads them.
fn snap(x: f64) -> f64 {
    let h = (x * 2.0).round() / 2.0;
    if (x - h).abs() <= 1e-12 * x.abs().max(1.0) {
        h
    } else {
        x
    }
}

/// Apply `f` (round, trunc, away-from-zero) at `digits` decimal places.
fn round_to(n: f64, digits: f64, f: fn(f64) -> f64) -> f64 {
    let d = digits.trunc().clamp(-15.0, 15.0) as i32;
    let scale = libm::pow(10.0, f64::from(d.abs()));
    if d >= 0 {
        f(snap(n * scale)) / scale
    } else {
        f(snap(n / scale)) * scale
    }
}

fn away_from_zero(x: f64) -> f64 {
    if x.fract() == 0.0 {
        x
    } else {
        x.trunc() + x.signum()
    }
}

fn mean(v: &[f64]) -> Result<Value, ErrCode> {
    if v.is_empty() {
        return Err(E::Div0);
    }
    number(v.iter().sum::<f64>() / v.len() as f64)
}

/// Sample variance.
fn variance(v: &[f64]) -> Result<f64, ErrCode> {
    if v.len() < 2 {
        return Err(E::Div0);
    }
    let m = v.iter().sum::<f64>() / v.len() as f64;
    Ok(v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / (v.len() - 1) as f64)
}

// ── Matching ────────────────────────────────────────────────────────────

/// `*` matches any run, `?` one character, `~` escapes the next;
/// case-insensitive; the whole text must match.
fn wildcard(pattern: &str, text: &str) -> bool {
    #[derive(PartialEq)]
    enum P {
        Lit(char),
        One,
        Any,
    }
    let mut pat = Vec::new();
    let mut it = pattern.chars().flat_map(char::to_lowercase);
    while let Some(c) = it.next() {
        pat.push(match c {
            '*' => P::Any,
            '?' => P::One,
            '~' => P::Lit(it.next().unwrap_or('~')),
            c => P::Lit(c),
        });
    }
    let t: Vec<char> = text.chars().flat_map(char::to_lowercase).collect();
    let (mut pi, mut ti) = (0, 0);
    let mut back: Option<(usize, usize)> = None;
    while ti < t.len() {
        match pat.get(pi) {
            Some(P::Any) => {
                back = Some((pi, ti));
                pi += 1;
            }
            Some(P::One) => {
                pi += 1;
                ti += 1;
            }
            Some(P::Lit(c)) if *c == t[ti] => {
                pi += 1;
                ti += 1;
            }
            _ => match back {
                Some((bp, bt)) => {
                    pi = bp + 1;
                    ti = bt + 1;
                    back = Some((bp, bt + 1));
                }
                None => return false,
            },
        }
    }
    pat[pi..].iter().all(|p| *p == P::Any)
}

/// A `COUNTIF`-style criterion: `">5"`, `"<>done"`, `"a*"`, or a plain value.
struct Criterion {
    op: Op,
    val: Value,
}

impl Criterion {
    fn new(v: Value) -> Criterion {
        let Value::Str(s) = v else {
            return Criterion { op: Op::Eq, val: v };
        };
        let (op, rest) = [
            ("<=", Op::Le),
            (">=", Op::Ge),
            ("<>", Op::Ne),
            ("<", Op::Lt),
            (">", Op::Gt),
            ("=", Op::Eq),
        ]
        .into_iter()
        .find_map(|(p, op)| s.strip_prefix(p).map(|r| (op, r)))
        .unwrap_or((Op::Eq, s.as_str()));
        let val = if rest.is_empty() {
            Value::Empty
        } else {
            Value::from_cell(Some(rest.to_string()))
        };
        Criterion { op, val }
    }

    fn matches(&self, cell: &Value) -> bool {
        match (&self.val, cell) {
            (Value::Empty, c) => {
                let blank = matches!(c, Value::Empty) || matches!(c, Value::Str(s) if s.is_empty());
                match self.op {
                    Op::Eq => blank,
                    Op::Ne => !blank,
                    _ => false,
                }
            }
            (Value::Str(p), Value::Str(s)) if self.op == Op::Eq => wildcard(p, s),
            (Value::Str(p), Value::Str(s)) if self.op == Op::Ne => !wildcard(p, s),
            (Value::Num(want), Value::Str(s)) => parse_number(s.trim())
                .map_or(self.op == Op::Ne, |n| {
                    holds(self.op, compare(&Value::Num(n), &Value::Num(*want)))
                }),
            (want, got) if same_kind(want, got) => holds(self.op, compare(got, want)),
            _ => self.op == Op::Ne,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Find {
    /// Equal value.
    Exact,
    /// Equal value, text matched with wildcards.
    Wild,
    /// Largest value `<=` the needle in an ascending list.
    SortedLe,
    /// Smallest value `>=` the needle in a descending list.
    SortedGe,
    /// Equal, else the largest smaller value, in any order.
    NextSmaller,
    /// Equal, else the smallest larger value, in any order.
    NextLarger,
}

fn find(needle: &Value, hay: &[Value], mode: Find) -> Option<usize> {
    let eq = |v: &Value| same_kind(v, needle) && compare(v, needle) == Equal;
    match mode {
        Find::Exact => hay.iter().position(eq),
        Find::Wild => hay.iter().position(|v| match (needle, v) {
            (Value::Str(p), Value::Str(s)) => wildcard(p, s),
            _ => eq(v),
        }),
        Find::SortedLe | Find::SortedGe => {
            let stop = if mode == Find::SortedLe {
                Greater
            } else {
                Less
            };
            let mut best = None;
            for (i, v) in hay.iter().enumerate() {
                if !same_kind(v, needle) {
                    continue;
                }
                if compare(v, needle) == stop {
                    break;
                }
                best = Some(i);
            }
            best
        }
        Find::NextSmaller | Find::NextLarger => hay.iter().position(eq).or_else(|| {
            let want = if mode == Find::NextSmaller {
                Less
            } else {
                Greater
            };
            hay.iter()
                .enumerate()
                .filter(|(_, v)| same_kind(v, needle) && compare(v, needle) == want)
                .reduce(|best, cur| {
                    if compare(cur.1, best.1) == want.reverse() {
                        cur
                    } else {
                        best
                    }
                })
                .map(|(i, _)| i)
        }),
    }
}

// ── Dates ───────────────────────────────────────────────────────────────

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/// Days from 1970-01-01 to a proleptic Gregorian date (H. Hinnant's
/// algorithm).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The serial of year `y`, month `m`, day `d`, where an out-of-range month or
/// day rolls over as in `DATE(2026, 13, 1)`.
fn date_serial(y: i64, m: i64, d: i64) -> Result<f64, ErrCode> {
    let y = y + (m - 1).div_euclid(12);
    let m = (m - 1).rem_euclid(12) + 1;
    if !(1900..=9999).contains(&y) {
        return Err(E::Num);
    }
    let s = days_from_civil(y, m as u32, 1) + d - 1 + EPOCH;
    if s < 0 {
        Err(E::Num)
    } else {
        Ok(s as f64)
    }
}

fn ymd(serial: f64) -> Result<(i64, u32, u32), ErrCode> {
    if !(0.0..2_958_466.0).contains(&serial) {
        return Err(E::Num);
    }
    Ok(civil_from_days(serial.floor() as i64 - EPOCH))
}

/// Seconds past midnight.
fn seconds_of(serial: f64) -> i64 {
    ((serial.fract() * 86_400.0).round() as i64).rem_euclid(86_400)
}

/// `2026-09-25`, optionally followed by ` 14:30` or `T14:30:05`.
fn parse_iso_date(s: &str) -> Option<f64> {
    let (date, time) = match s.split_once([' ', 'T']) {
        Some((d, t)) => (d, Some(t)),
        None => (s, None),
    };
    let mut p = date.split('-');
    let y: i64 = p.next()?.parse().ok()?;
    let m: u32 = p.next()?.parse().ok()?;
    let d: u32 = p.next()?.parse().ok()?;
    if p.next().is_some()
        || !(1..=12).contains(&m)
        || !(1..=31).contains(&d)
        || !(1900..=9999).contains(&y)
    {
        return None;
    }
    let mut serial = (days_from_civil(y, m, d) + EPOCH) as f64;
    if let Some(t) = time {
        let mut q = t.split(':');
        let h: f64 = q.next()?.parse().ok()?;
        let mi: f64 = q.next()?.parse().ok()?;
        let sec: f64 = q.next().map_or(Some(0.0), |x| x.parse().ok())?;
        serial += (h * 3600.0 + mi * 60.0 + sec) / 86_400.0;
    }
    Some(serial)
}

/// A date argument: a serial, or an ISO date typed as text.
fn date_arg(v: &Value) -> Result<f64, ErrCode> {
    match v {
        Value::Str(s) => parse_iso_date(s.trim())
            .or_else(|| parse_number(s.trim()))
            .ok_or(E::Val),
        v => v.num(),
    }
}

/// Text as `VALUE()` reads it: `1,234`, `$5`, `12%`, or an ISO date.
fn parse_value_text(s: &str) -> Option<f64> {
    let t = s.trim();
    if let Some(p) = t.strip_suffix('%') {
        return parse_value_text(p).map(|n| n / 100.0);
    }
    let plain: String = t.chars().filter(|c| !matches!(c, ',' | '$')).collect();
    parse_number(&plain).or_else(|| parse_iso_date(t))
}

// ── TEXT() formats ──────────────────────────────────────────────────────

fn text_format(v: &Value, fmt: &str) -> Result<String, ErrCode> {
    let n = match v {
        Value::Str(s) => match parse_value_text(s) {
            Some(n) => n,
            None => return Ok(s.clone()),
        },
        v => v.num()?,
    };
    if fmt.contains(['0', '#']) {
        Ok(format_pattern(n, fmt))
    } else if fmt.to_ascii_lowercase().contains(['y', 'm', 'd', 'h', 's']) {
        format_date(n, fmt)
    } else {
        Ok(fmt.to_string())
    }
}

/// `0`, `0.00`, `#,##0`, `0.0%`, `$#,##0.00`: digits between the first and last
/// `0`/`#`, literal text around them.
fn format_pattern(n: f64, fmt: &str) -> String {
    let chars: Vec<char> = fmt.chars().collect();
    let digit = |c: &char| matches!(c, '0' | '#');
    let first = chars.iter().position(digit).unwrap_or(0);
    let last = chars.iter().rposition(digit).unwrap_or(0);
    let prefix: String = chars[..first].iter().collect();
    let suffix: String = chars[last + 1..].iter().collect();
    let body: String = chars[first..=last].iter().collect();
    let n = if fmt.contains('%') { n * 100.0 } else { n };
    let (int_pat, frac_pat) = body.split_once('.').unwrap_or((&body, ""));
    let decimals = frac_pat.chars().filter(digit).count();
    let min_frac = frac_pat.chars().filter(|&c| c == '0').count();
    let min_int = int_pat.chars().filter(|&c| c == '0').count();
    let rounded = round_to(n.abs(), decimals as f64, f64::round);
    let s = format!("{rounded:.decimals$}");
    let (ip, fp) = s.split_once('.').unwrap_or((&s, ""));
    let mut ip = ip.trim_start_matches('0').to_string();
    while ip.len() < min_int {
        ip.insert(0, '0');
    }
    if int_pat.contains(',') {
        let digits: Vec<char> = ip.chars().collect();
        ip = digits
            .rchunks(3)
            .rev()
            .map(|c| c.iter().collect::<String>())
            .collect::<Vec<_>>()
            .join(",");
    }
    let mut fp = fp.to_string();
    while fp.len() > min_frac && fp.ends_with('0') {
        fp.pop();
    }
    let sign = if n < 0.0 && rounded != 0.0 { "-" } else { "" };
    let dot = if fp.is_empty() { "" } else { "." };
    format!("{sign}{prefix}{ip}{dot}{fp}{suffix}")
}

/// `yyyy-mm-dd`, `d mmm yyyy`, `dddd`, `hh:mm:ss`. An `m` after an hour or
/// before a second is minutes, as in every spreadsheet.
fn format_date(serial: f64, fmt: &str) -> Result<String, ErrCode> {
    let (y, m, d) = ymd(serial)?;
    let secs = seconds_of(serial);
    let weekday = (serial.floor() as i64 - EPOCH + 4).rem_euclid(7) as usize;
    let month = MONTHS[m as usize - 1];
    let pad = |v: i64, run: usize| {
        if run >= 2 {
            format!("{v:02}")
        } else {
            v.to_string()
        }
    };
    let chars: Vec<char> = fmt.chars().collect();
    let mut out = String::new();
    let mut after_hour = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i].to_ascii_lowercase();
        let run = chars[i..]
            .iter()
            .take_while(|x| x.to_ascii_lowercase() == c)
            .count();
        match c {
            'y' if run <= 2 => out += &format!("{:02}", y % 100),
            'y' => out += &y.to_string(),
            'm' => {
                let before_second = chars[i + run..]
                    .iter()
                    .find(|x| x.is_ascii_alphabetic())
                    .is_some_and(|x| x.eq_ignore_ascii_case(&'s'));
                out += &match run {
                    1 | 2 if after_hour || before_second => pad(secs / 60 % 60, run),
                    1 | 2 => pad(i64::from(m), run),
                    3 => month[..3].to_string(),
                    _ => month.to_string(),
                };
            }
            'd' => {
                out += &match run {
                    1 | 2 => pad(i64::from(d), run),
                    3 => WEEKDAYS[weekday][..3].to_string(),
                    _ => WEEKDAYS[weekday].to_string(),
                }
            }
            'h' => out += &pad(secs / 3600, run),
            's' => out += &pad(secs % 60, run),
            _ => out.extend(&chars[i..i + run]),
        }
        if matches!(c, 'y' | 'm' | 'd' | 'h' | 's') {
            after_hour = c == 'h';
        }
        i += run;
    }
    Ok(out)
}

// ── Evaluation ──────────────────────────────────────────────────────────

struct Ctx<'a, F> {
    get: &'a F,
    env: &'a Env,
}

impl<F: Fn(Option<&str>, u32, u32) -> Option<String>> Ctx<'_, F> {
    fn eval(&self, e: &Expr) -> Value {
        match e {
            Expr::Num(n) => Value::Num(*n),
            Expr::Str(s) => Value::Str(s.clone()),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Err(e) => Value::Err(*e),
            Expr::Blank => Value::Empty,
            Expr::Ref(r) => self.range(r),
            Expr::Name(n) => match name_ref(&self.env.names, n) {
                Some(r) => self.range(&r),
                None => Value::Err(E::Name),
            },
            Expr::Call(name, args) => self.call(name, args).unwrap_or_else(Value::Err),
            Expr::Neg(x) => self
                .scalar(x)
                .num()
                .map_or_else(Value::Err, |n| Value::Num(-n)),
            Expr::Percent(x) => self
                .scalar(x)
                .num()
                .map_or_else(Value::Err, |n| Value::Num(n / 100.0)),
            Expr::Bin(op, a, b) => self.binary(*op, a, b).unwrap_or_else(Value::Err),
        }
    }

    fn scalar(&self, e: &Expr) -> Value {
        self.eval(e).scalar()
    }

    fn range(&self, r: &RefExpr) -> Value {
        let mut cells = Vec::new();
        for row in r.r1..=r.r2 {
            for col in r.c1..=r.c2 {
                cells.push(Value::from_cell((self.get)(r.sheet.as_deref(), row, col)));
            }
        }
        Value::Grid(Grid {
            rows: (r.r2 - r.r1 + 1) as usize,
            cols: (r.c2 - r.c1 + 1) as usize,
            cells,
        })
    }

    fn binary(&self, op: Op, a: &Expr, b: &Expr) -> Result<Value, ErrCode> {
        let x = self.scalar(a).checked()?;
        let y = self.scalar(b).checked()?;
        let (p, q) = match op {
            Op::Cat => return Ok(Value::Str(x.text()? + &y.text()?)),
            Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => {
                return Ok(Value::Bool(holds(op, compare(&x, &y))))
            }
            Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Pow => (x.num()?, y.num()?),
        };
        number(match op {
            Op::Add => p + q,
            Op::Sub => p - q,
            Op::Mul => p * q,
            Op::Div if q == 0.0 => return Err(E::Div0),
            Op::Div => p / q,
            _ => power(p, q)?,
        })
    }

    fn grid_of(&self, e: &Expr) -> Result<Grid, ErrCode> {
        match self.eval(e) {
            Value::Grid(g) => Ok(g),
            Value::Err(e) => Err(e),
            v => Ok(Grid {
                rows: 1,
                cols: 1,
                cells: vec![v],
            }),
        }
    }

    /// A one-row or one-column range, as a list.
    fn vector_of(&self, e: &Expr) -> Result<Vec<Value>, ErrCode> {
        let g = self.grid_of(e)?;
        if g.rows == 1 || g.cols == 1 {
            Ok(g.cells)
        } else {
            Err(E::Val)
        }
    }

    /// The numbers an aggregate reads: a range gives only its numeric cells
    /// (text, logicals and blanks are skipped), a value typed into the call is
    /// coerced, so `SUM("3", TRUE)` is 4. An error anywhere is the result.
    fn numbers(&self, args: &[Expr]) -> Result<Vec<f64>, ErrCode> {
        let mut out = Vec::new();
        for a in args {
            match self.eval(a) {
                Value::Grid(g) => {
                    for v in g.cells {
                        match v {
                            Value::Num(n) => out.push(n),
                            Value::Err(e) => return Err(e),
                            _ => {}
                        }
                    }
                }
                Value::Empty => {}
                v => out.push(v.num()?),
            }
        }
        Ok(out)
    }

    fn texts(&self, args: &[Expr]) -> Result<Vec<String>, ErrCode> {
        let mut out = Vec::new();
        for a in args {
            match self.eval(a) {
                Value::Grid(g) => {
                    for v in &g.cells {
                        out.push(v.text()?);
                    }
                }
                v => out.push(v.text()?),
            }
        }
        Ok(out)
    }

    fn bools(&self, args: &[Expr]) -> Result<Vec<bool>, ErrCode> {
        let mut out = Vec::new();
        for a in args {
            match self.eval(a) {
                Value::Grid(g) => {
                    for v in &g.cells {
                        match v {
                            Value::Num(_) | Value::Bool(_) => out.push(v.truthy()?),
                            Value::Err(e) => return Err(*e),
                            _ => {}
                        }
                    }
                }
                Value::Empty => {}
                v => out.push(v.truthy()?),
            }
        }
        if out.is_empty() {
            Err(E::Val)
        } else {
            Ok(out)
        }
    }

    /// Which cells of the ranges in `(range, criterion)` pairs meet every
    /// criterion, and the ranges' shape.
    fn mask(&self, pairs: &[Expr]) -> Result<(Vec<bool>, (usize, usize)), ErrCode> {
        if pairs.is_empty() || pairs.len() % 2 != 0 {
            return Err(E::Val);
        }
        let mut mask: Vec<bool> = Vec::new();
        let mut shape = (0, 0);
        for (i, pair) in pairs.chunks(2).enumerate() {
            let g = self.grid_of(&pair[0])?;
            let crit = Criterion::new(self.scalar(&pair[1]).checked()?);
            if i == 0 {
                shape = (g.rows, g.cols);
                mask = vec![true; g.cells.len()];
            } else if shape != (g.rows, g.cols) {
                return Err(E::Val);
            }
            for (m, v) in mask.iter_mut().zip(&g.cells) {
                *m &= crit.matches(v);
            }
        }
        Ok((mask, shape))
    }

    /// The numeric cells of `target` where `mask` holds.
    fn masked(
        &self,
        target: &Expr,
        mask: &[bool],
        shape: (usize, usize),
    ) -> Result<Vec<f64>, ErrCode> {
        let g = self.grid_of(target)?;
        if (g.rows, g.cols) != shape {
            return Err(E::Val);
        }
        Ok(g.cells
            .iter()
            .zip(mask)
            .filter_map(|(v, m)| match v {
                Value::Num(n) if *m => Some(*n),
                _ => None,
            })
            .collect())
    }

    fn now(&self) -> f64 {
        self.env.now_ms as f64 / 86_400_000.0 + EPOCH as f64
    }

    fn call(&self, name: &str, a: &[Expr]) -> Result<Value, ErrCode> {
        let n = a.len();
        let arity = |lo: usize, hi: usize| {
            if (lo..=hi).contains(&n) {
                Ok(())
            } else {
                Err(E::Val)
            }
        };
        let given = |i: usize| i < n && a[i] != Expr::Blank;
        let val = |i: usize| self.scalar(&a[i]).checked();
        let num = |i: usize| self.scalar(&a[i]).num();
        let text = |i: usize| self.scalar(&a[i]).text();
        let truthy = |i: usize| self.scalar(&a[i]).truthy();
        let num_or = |i: usize, d: f64| if given(i) { num(i) } else { Ok(d) };
        let date = |i: usize| date_arg(&self.scalar(&a[i]));
        let chars = |i: usize| text(i).map(|t| t.chars().collect::<Vec<char>>());
        let str_of = |c: &[char]| Value::Str(c.iter().collect());

        match name {
            // ── Math ──
            "ABS" => {
                arity(1, 1)?;
                number(num(0)?.abs())
            }
            "CEILING" | "FLOOR" => {
                arity(1, 2)?;
                let (x, s) = (num(0)?, num_or(1, 1.0)?);
                if s == 0.0 {
                    return if name == "CEILING" {
                        number(0.0)
                    } else {
                        Err(E::Div0)
                    };
                }
                let q = snap(x / s);
                number(
                    if name == "CEILING" {
                        q.ceil()
                    } else {
                        q.floor()
                    } * s,
                )
            }
            "EXP" => {
                arity(1, 1)?;
                number(libm::exp(num(0)?))
            }
            "INT" => {
                arity(1, 1)?;
                number(snap(num(0)?).floor())
            }
            "LN" | "LOG10" => {
                arity(1, 1)?;
                let x = num(0)?;
                if x <= 0.0 {
                    return Err(E::Num);
                }
                number(if name == "LN" { libm::log(x) } else { libm::log10(x) })
            }
            "LOG" => {
                arity(1, 2)?;
                let (x, b) = (num(0)?, num_or(1, 10.0)?);
                if x <= 0.0 || b <= 0.0 {
                    Err(E::Num)
                } else if b == 1.0 {
                    Err(E::Div0)
                } else if b == 10.0 {
                    number(libm::log10(x))
                } else {
                    number(libm::log(x) / libm::log(b))
                }
            }
            "MOD" => {
                arity(2, 2)?;
                let (x, d) = (num(0)?, num(1)?);
                if d == 0.0 {
                    return Err(E::Div0);
                }
                number(x - d * snap(x / d).floor())
            }
            "PI" => {
                arity(0, 0)?;
                number(std::f64::consts::PI)
            }
            "POWER" => {
                arity(2, 2)?;
                number(power(num(0)?, num(1)?)?)
            }
            "PRODUCT" => {
                let v = self.numbers(a)?;
                number(if v.is_empty() {
                    0.0
                } else {
                    v.iter().product()
                })
            }
            "ROUND" | "ROUNDDOWN" | "ROUNDUP" | "TRUNC" => {
                if name == "TRUNC" {
                    arity(1, 2)?;
                } else {
                    arity(2, 2)?;
                }
                let f: fn(f64) -> f64 = match name {
                    "ROUND" => f64::round,
                    "ROUNDUP" => away_from_zero,
                    _ => f64::trunc,
                };
                number(round_to(num(0)?, num_or(1, 0.0)?, f))
            }
            "SIGN" => {
                arity(1, 1)?;
                let x = num(0)?;
                number(if x == 0.0 { 0.0 } else { x.signum() })
            }
            "SQRT" => {
                arity(1, 1)?;
                let x = num(0)?;
                if x < 0.0 {
                    return Err(E::Num);
                }
                number(x.sqrt())
            }
            "SUM" => number(self.numbers(a)?.iter().sum()),
            "SUMIF" | "AVERAGEIF" => {
                arity(2, 3)?;
                let (mask, shape) = self.mask(&a[..2])?;
                let v = self.masked(if given(2) { &a[2] } else { &a[0] }, &mask, shape)?;
                if name == "SUMIF" {
                    number(v.iter().sum())
                } else {
                    mean(&v)
                }
            }
            "SUMIFS" | "AVERAGEIFS" => {
                if n < 3 || n % 2 == 0 {
                    return Err(E::Val);
                }
                let (mask, shape) = self.mask(&a[1..])?;
                let v = self.masked(&a[0], &mask, shape)?;
                if name == "SUMIFS" {
                    number(v.iter().sum())
                } else {
                    mean(&v)
                }
            }
            "SUMPRODUCT" => {
                let grids = a
                    .iter()
                    .map(|e| self.grid_of(e))
                    .collect::<Result<Vec<_>, _>>()?;
                let Some(first) = grids.first() else {
                    return Err(E::Val);
                };
                if grids
                    .iter()
                    .any(|g| (g.rows, g.cols) != (first.rows, first.cols))
                {
                    return Err(E::Val);
                }
                let mut total = 0.0;
                for i in 0..first.cells.len() {
                    let mut p = 1.0;
                    for g in &grids {
                        match &g.cells[i] {
                            Value::Num(x) => p *= x,
                            Value::Err(e) => return Err(*e),
                            _ => p = 0.0,
                        }
                    }
                    total += p;
                }
                number(total)
            }

            // ── Statistical ──
            "AVERAGE" => mean(&self.numbers(a)?),
            "COUNT" | "COUNTA" => {
                let mut count = 0;
                for e in a {
                    match self.eval(e) {
                        Value::Grid(g) => {
                            count += g
                                .cells
                                .iter()
                                .filter(|v| match v {
                                    Value::Num(_) => true,
                                    Value::Empty => false,
                                    _ => name == "COUNTA",
                                })
                                .count();
                        }
                        Value::Empty if *e == Expr::Blank => {}
                        v if name == "COUNTA" || matches!(v, Value::Num(_) | Value::Bool(_)) => {
                            count += 1
                        }
                        v => count += usize::from(v.num().is_ok()),
                    }
                }
                number(count as f64)
            }
            "COUNTBLANK" => {
                arity(1, 1)?;
                let g = self.grid_of(&a[0])?;
                let blank = |v: &&Value| {
                    matches!(v, Value::Empty) || matches!(v, Value::Str(s) if s.is_empty())
                };
                number(g.cells.iter().filter(blank).count() as f64)
            }
            "COUNTIF" | "COUNTIFS" => {
                if name == "COUNTIF" {
                    arity(2, 2)?;
                }
                let (mask, _) = self.mask(a)?;
                number(mask.iter().filter(|m| **m).count() as f64)
            }
            "LARGE" | "SMALL" => {
                arity(2, 2)?;
                let mut v = self.numbers(&a[..1])?;
                let k = index(num(1)?).map_err(|_| E::Num)?;
                if k > v.len() {
                    return Err(E::Num);
                }
                v.sort_by(f64::total_cmp);
                number(if name == "LARGE" {
                    v[v.len() - k]
                } else {
                    v[k - 1]
                })
            }
            "MAX" | "MIN" => {
                let v = self.numbers(a)?;
                let pick = if name == "MAX" { f64::max } else { f64::min };
                number(v.into_iter().reduce(pick).unwrap_or(0.0))
            }
            "MEDIAN" => {
                let mut v = self.numbers(a)?;
                if v.is_empty() {
                    return Err(E::Num);
                }
                v.sort_by(f64::total_cmp);
                let mid = v.len() / 2;
                number(if v.len() % 2 == 0 {
                    (v[mid - 1] + v[mid]) / 2.0
                } else {
                    v[mid]
                })
            }
            "STDEV" => number(variance(&self.numbers(a)?)?.sqrt()),
            "VAR" => number(variance(&self.numbers(a)?)?),

            // ── Logical ──
            "AND" => Ok(Value::Bool(self.bools(a)?.iter().all(|b| *b))),
            "OR" => Ok(Value::Bool(self.bools(a)?.iter().any(|b| *b))),
            "XOR" => Ok(Value::Bool(
                self.bools(a)?.iter().filter(|b| **b).count() % 2 == 1,
            )),
            "TRUE" | "FALSE" => {
                arity(0, 0)?;
                Ok(Value::Bool(name == "TRUE"))
            }
            "IF" => {
                arity(2, 3)?;
                if truthy(0)? {
                    Ok(self.eval(&a[1]))
                } else if given(2) {
                    Ok(self.eval(&a[2]))
                } else {
                    Ok(Value::Bool(false))
                }
            }
            "IFERROR" | "IFNA" => {
                arity(2, 2)?;
                match self.scalar(&a[0]) {
                    Value::Err(e) if name == "IFERROR" || e == E::Na => Ok(self.eval(&a[1])),
                    v => Ok(v),
                }
            }
            "IFS" => {
                if n == 0 || n % 2 != 0 {
                    return Err(E::Val);
                }
                for pair in a.chunks(2) {
                    if self.scalar(&pair[0]).truthy()? {
                        return Ok(self.eval(&pair[1]));
                    }
                }
                Err(E::Na)
            }
            "NOT" => {
                arity(1, 1)?;
                Ok(Value::Bool(!truthy(0)?))
            }
            "SWITCH" => {
                if n < 3 {
                    return Err(E::Val);
                }
                let key = val(0)?;
                for pair in a[1..].chunks(2) {
                    let [case, result] = pair else {
                        return Ok(self.eval(&pair[0]));
                    };
                    let c = self.scalar(case).checked()?;
                    if same_kind(&c, &key) && compare(&c, &key) == Equal {
                        return Ok(self.eval(result));
                    }
                }
                Err(E::Na)
            }

            // ── Lookup ──
            "CHOOSE" => {
                if n < 2 {
                    return Err(E::Val);
                }
                let i = index(num(0)?)?;
                if i >= n {
                    return Err(E::Val);
                }
                Ok(self.eval(&a[i]))
            }
            "COLUMNS" | "ROWS" => {
                arity(1, 1)?;
                let g = self.grid_of(&a[0])?;
                number(if name == "ROWS" { g.rows } else { g.cols } as f64)
            }
            "HLOOKUP" | "VLOOKUP" => {
                arity(3, 4)?;
                let needle = val(0)?;
                let t = self.grid_of(&a[1])?;
                let k = index(num(2)?)?;
                let approx = if given(3) { truthy(3)? } else { true };
                let vertical = name == "VLOOKUP";
                let (len, width) = if vertical {
                    (t.rows, t.cols)
                } else {
                    (t.cols, t.rows)
                };
                if k > width {
                    return Err(E::Ref);
                }
                let keys: Vec<Value> = (0..len)
                    .map(|i| if vertical { t.get(i, 0) } else { t.get(0, i) }.clone())
                    .collect();
                let mode = if approx { Find::SortedLe } else { Find::Wild };
                let pos = find(&needle, &keys, mode).ok_or(E::Na)?;
                Ok(if vertical {
                    t.get(pos, k - 1)
                } else {
                    t.get(k - 1, pos)
                }
                .clone())
            }
            "INDEX" => {
                arity(2, 3)?;
                let g = self.grid_of(&a[0])?;
                let (r, c) = if n == 2 && g.rows == 1 {
                    (1.0, num(1)?)
                } else {
                    (num(1)?, num_or(2, 1.0)?)
                };
                let (r, c) = (index(r)?, index(c)?);
                if r > g.rows || c > g.cols {
                    return Err(E::Ref);
                }
                Ok(g.get(r - 1, c - 1).clone())
            }
            "MATCH" => {
                arity(2, 3)?;
                let needle = val(0)?;
                let hay = self.vector_of(&a[1])?;
                let t = num_or(2, 1.0)?;
                let mode = if t > 0.0 {
                    Find::SortedLe
                } else if t < 0.0 {
                    Find::SortedGe
                } else {
                    Find::Wild
                };
                let pos = find(&needle, &hay, mode).ok_or(E::Na)?;
                number((pos + 1) as f64)
            }
            "XLOOKUP" => {
                arity(3, 6)?;
                let needle = val(0)?;
                let keys = self.vector_of(&a[1])?;
                let out = self.grid_of(&a[2])?;
                let mode = match num_or(4, 0.0)? as i64 {
                    0 => Find::Exact,
                    -1 => Find::NextSmaller,
                    1 => Find::NextLarger,
                    2 => Find::Wild,
                    _ => return Err(E::Val),
                };
                let pos = if num_or(5, 1.0)? < 0.0 {
                    let rev: Vec<Value> = keys.iter().rev().cloned().collect();
                    find(&needle, &rev, mode).map(|i| keys.len() - 1 - i)
                } else {
                    find(&needle, &keys, mode)
                };
                let Some(pos) = pos else {
                    return if given(3) {
                        Ok(self.eval(&a[3]))
                    } else {
                        Err(E::Na)
                    };
                };
                if out.rows == keys.len() {
                    Ok(out.row(pos))
                } else if out.cols == keys.len() {
                    Ok(out.col(pos))
                } else {
                    Err(E::Val)
                }
            }

            // ── Text ──
            "CONCAT" | "CONCATENATE" => Ok(Value::Str(self.texts(a)?.concat())),
            "EXACT" => {
                arity(2, 2)?;
                Ok(Value::Bool(text(0)? == text(1)?))
            }
            "FIND" | "SEARCH" => {
                arity(2, 3)?;
                let needle = text(0)?;
                let hay = chars(1)?;
                let start = index(num_or(2, 1.0)?)?;
                if start > hay.len() + 1 {
                    return Err(E::Val);
                }
                let found = if name == "FIND" {
                    let nd: Vec<char> = needle.chars().collect();
                    (start - 1..=hay.len()).find(|&i| hay[i..].starts_with(&nd))
                } else {
                    let pattern = format!("{needle}*");
                    (start - 1..=hay.len())
                        .find(|&i| wildcard(&pattern, &hay[i..].iter().collect::<String>()))
                };
                found.map_or(Err(E::Val), |i| number((i + 1) as f64))
            }
            "LEFT" | "RIGHT" => {
                arity(1, 2)?;
                let t = chars(0)?;
                let k = num_or(1, 1.0)?;
                if k < 0.0 {
                    return Err(E::Val);
                }
                let k = (k as usize).min(t.len());
                Ok(str_of(if name == "LEFT" {
                    &t[..k]
                } else {
                    &t[t.len() - k..]
                }))
            }
            "LEN" => {
                arity(1, 1)?;
                number(chars(0)?.len() as f64)
            }
            "LOWER" => {
                arity(1, 1)?;
                Ok(Value::Str(text(0)?.to_lowercase()))
            }
            "UPPER" => {
                arity(1, 1)?;
                Ok(Value::Str(text(0)?.to_uppercase()))
            }
            "PROPER" => {
                arity(1, 1)?;
                let mut out = String::new();
                let mut start = true;
                for c in text(0)?.chars() {
                    if start {
                        out.extend(c.to_uppercase());
                    } else {
                        out.extend(c.to_lowercase());
                    }
                    start = !c.is_alphabetic();
                }
                Ok(Value::Str(out))
            }
            "MID" | "REPLACE" => {
                if name == "MID" {
                    arity(3, 3)?;
                } else {
                    arity(4, 4)?;
                }
                let t = chars(0)?;
                let s = index(num(1)?)?;
                let k = num(2)?;
                if k < 0.0 {
                    return Err(E::Val);
                }
                let from = (s - 1).min(t.len());
                let to = from.saturating_add(k as usize).min(t.len());
                if name == "MID" {
                    return Ok(str_of(&t[from..to]));
                }
                let mut out: String = t[..from].iter().collect();
                out += &text(3)?;
                out.extend(&t[to..]);
                Ok(Value::Str(out))
            }
            "REPT" => {
                arity(2, 2)?;
                let (t, k) = (text(0)?, num(1)?);
                if k < 0.0 || t.chars().count() as f64 * k.trunc() > 32_767.0 {
                    return Err(E::Val);
                }
                Ok(Value::Str(t.repeat(k as usize)))
            }
            "SUBSTITUTE" => {
                arity(3, 4)?;
                let (t, old, new) = (text(0)?, text(1)?, text(2)?);
                if old.is_empty() {
                    return Ok(Value::Str(t));
                }
                if !given(3) {
                    return Ok(Value::Str(t.replace(&old, &new)));
                }
                let k = index(num(3)?)?;
                Ok(Value::Str(match t.match_indices(&old).nth(k - 1) {
                    Some((i, _)) => format!("{}{new}{}", &t[..i], &t[i + old.len()..]),
                    None => t,
                }))
            }
            "TEXT" => {
                arity(2, 2)?;
                Ok(Value::Str(text_format(&val(0)?, &text(1)?)?))
            }
            "TEXTJOIN" => {
                if n < 3 {
                    return Err(E::Val);
                }
                let delim = text(0)?;
                let skip_empty = truthy(1)?;
                let parts: Vec<String> = self
                    .texts(&a[2..])?
                    .into_iter()
                    .filter(|s| !(skip_empty && s.is_empty()))
                    .collect();
                Ok(Value::Str(parts.join(&delim)))
            }
            "TRIM" => {
                arity(1, 1)?;
                Ok(Value::Str(
                    text(0)?
                        .split(' ')
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" "),
                ))
            }
            "VALUE" => {
                arity(1, 1)?;
                match val(0)? {
                    Value::Str(s) => number(parse_value_text(&s).ok_or(E::Val)?),
                    v => number(v.num()?),
                }
            }

            // ── Date ──
            "DATE" => {
                arity(3, 3)?;
                let y = int_arg(num(0)?)?;
                // Two-digit and pre-1900 years count from 1900, as in Excel.
                let y = if (0..1900).contains(&y) { y + 1900 } else { y };
                number(date_serial(y, int_arg(num(1)?)?, int_arg(num(2)?)?)?)
            }
            "DAY" | "MONTH" | "YEAR" => {
                arity(1, 1)?;
                let (y, m, d) = ymd(date(0)?)?;
                number(match name {
                    "DAY" => f64::from(d),
                    "MONTH" => f64::from(m),
                    _ => y as f64,
                })
            }
            "DAYS" => {
                arity(2, 2)?;
                number(date(0)?.floor() - date(1)?.floor())
            }
            "EDATE" | "EOMONTH" => {
                arity(2, 2)?;
                let (y, m, d) = ymd(date(0)?)?;
                let m = i64::from(m) + int_arg(num(1)?)?;
                let next = date_serial(y, m + 1, 1)?;
                if name == "EOMONTH" {
                    return number(next - 1.0);
                }
                let first = date_serial(y, m, 1)?;
                number(first + f64::from(d).min(next - first) - 1.0)
            }
            "HOUR" | "MINUTE" | "SECOND" => {
                arity(1, 1)?;
                let s = date(0)?;
                if s < 0.0 {
                    return Err(E::Num);
                }
                let secs = seconds_of(s);
                number(match name {
                    "HOUR" => secs / 3600,
                    "MINUTE" => secs / 60 % 60,
                    _ => secs % 60,
                } as f64)
            }
            "NOW" => {
                arity(0, 0)?;
                number(self.now())
            }
            "TODAY" => {
                arity(0, 0)?;
                number(self.now().floor())
            }
            "WEEKDAY" => {
                arity(1, 2)?;
                let days = date(0)?.floor() as i64 - EPOCH;
                let sunday0 = (days + 4).rem_euclid(7);
                let monday0 = (sunday0 + 6) % 7;
                number(match num_or(1, 1.0)? as i64 {
                    1 => sunday0 + 1,
                    2 => monday0 + 1,
                    3 => monday0,
                    _ => return Err(E::Num),
                } as f64)
            }

            // ── Information ──
            "ISBLANK" | "ISERROR" | "ISNA" | "ISNUMBER" | "ISTEXT" => {
                arity(1, 1)?;
                let v = self.scalar(&a[0]);
                Ok(Value::Bool(match name {
                    "ISBLANK" => v == Value::Empty,
                    "ISERROR" => matches!(v, Value::Err(_)),
                    "ISNA" => v == Value::Err(E::Na),
                    "ISNUMBER" => matches!(v, Value::Num(_)),
                    _ => matches!(v, Value::Str(_)),
                }))
            }
            "NA" => {
                arity(0, 0)?;
                Err(E::Na)
            }
            _ => Err(E::Name),
        }
    }
}

// ── Catalog ─────────────────────────────────────────────────────────────

/// One function the engine implements, as the function help shows it.
#[derive(Clone, Copy, Debug)]
pub struct FnInfo {
    pub name: &'static str,
    pub category: &'static str,
    pub syntax: &'static str,
    pub description: &'static str,
    pub example: &'static str,
}

macro_rules! catalog {
    ($($name:literal, $cat:literal, $syntax:literal, $desc:literal, $ex:literal;)*) => {
        &[$(FnInfo { name: $name, category: $cat, syntax: $syntax, description: $desc, example: $ex },)*]
    };
}

/// Every function [`evaluate`] implements, sorted by name.
pub const CATALOG: &[FnInfo] = catalog! {
    "ABS", "Math", "ABS(number)", "The number without its sign.", "=ABS(-4)";
    "AND", "Logical", "AND(logical1, [logical2], ...)", "TRUE when every argument is true.", "=AND(A1>0, B1>0)";
    "AVERAGE", "Statistical", "AVERAGE(value1, [value2], ...)", "The mean of the numbers.", "=AVERAGE(A1:A10)";
    "AVERAGEIF", "Statistical", "AVERAGEIF(range, criterion, [average_range])", "The mean of the cells that meet a criterion.", "=AVERAGEIF(A1:A10, \">0\")";
    "AVERAGEIFS", "Statistical", "AVERAGEIFS(average_range, range1, criterion1, ...)", "The mean of the cells that meet every criterion.", "=AVERAGEIFS(C1:C10, A1:A10, \"East\", B1:B10, \">5\")";
    "CEILING", "Math", "CEILING(number, [significance])", "Rounds up to the nearest multiple of significance.", "=CEILING(4.2, 0.5)";
    "CHOOSE", "Lookup", "CHOOSE(index, value1, [value2], ...)", "The value at a 1-based position in the list.", "=CHOOSE(2, \"low\", \"mid\", \"high\")";
    "COLUMNS", "Lookup", "COLUMNS(range)", "How many columns a range has.", "=COLUMNS(A1:D1)";
    "CONCAT", "Text", "CONCAT(text1, [text2], ...)", "Joins text, including every cell of a range.", "=CONCAT(A1, \" \", B1)";
    "CONCATENATE", "Text", "CONCATENATE(text1, [text2], ...)", "Joins text.", "=CONCATENATE(\"Q\", 3)";
    "COUNT", "Statistical", "COUNT(value1, [value2], ...)", "How many values are numbers.", "=COUNT(A1:A10)";
    "COUNTA", "Statistical", "COUNTA(value1, [value2], ...)", "How many values are not empty.", "=COUNTA(A1:A10)";
    "COUNTBLANK", "Statistical", "COUNTBLANK(range)", "How many cells of a range are empty.", "=COUNTBLANK(A1:A10)";
    "COUNTIF", "Statistical", "COUNTIF(range, criterion)", "How many cells meet a criterion such as \">5\" or \"a*\".", "=COUNTIF(A1:A10, \">5\")";
    "COUNTIFS", "Statistical", "COUNTIFS(range1, criterion1, [range2, criterion2], ...)", "How many rows meet every criterion.", "=COUNTIFS(A1:A10, \"East\", B1:B10, \">5\")";
    "DATE", "Date", "DATE(year, month, day)", "The date serial for a year, month and day.", "=DATE(2026, 9, 25)";
    "DAY", "Date", "DAY(date)", "The day of the month, 1 to 31.", "=DAY(DATE(2026, 9, 25))";
    "DAYS", "Date", "DAYS(end_date, start_date)", "Days between two dates.", "=DAYS(DATE(2026, 12, 25), DATE(2026, 9, 25))";
    "EDATE", "Date", "EDATE(start_date, months)", "The same day a number of months away.", "=EDATE(DATE(2026, 1, 31), 1)";
    "EOMONTH", "Date", "EOMONTH(start_date, months)", "The last day of the month a number of months away.", "=EOMONTH(DATE(2026, 2, 10), 0)";
    "EXACT", "Text", "EXACT(text1, text2)", "TRUE when two texts match exactly, case included.", "=EXACT(\"Ada\", \"ada\")";
    "EXP", "Math", "EXP(number)", "e raised to a power.", "=EXP(1)";
    "FALSE", "Logical", "FALSE()", "The logical value FALSE.", "=FALSE()";
    "FIND", "Text", "FIND(find_text, within_text, [start])", "Where text first appears, case-sensitive.", "=FIND(\"l\", \"hello\")";
    "FLOOR", "Math", "FLOOR(number, [significance])", "Rounds down to the nearest multiple of significance.", "=FLOOR(4.7, 0.5)";
    "HLOOKUP", "Lookup", "HLOOKUP(value, table, row, [approximate])", "Finds a value in a table's first row and returns the cell in the given row.", "=HLOOKUP(\"Q2\", A1:D3, 2, FALSE)";
    "HOUR", "Date", "HOUR(time)", "The hour, 0 to 23.", "=HOUR(NOW())";
    "IF", "Logical", "IF(condition, value_if_true, [value_if_false])", "One value when a condition holds, another when it does not.", "=IF(A1>100, \"over\", \"ok\")";
    "IFERROR", "Logical", "IFERROR(value, value_if_error)", "The value, or a fallback when it is an error.", "=IFERROR(A1/B1, 0)";
    "IFNA", "Logical", "IFNA(value, value_if_na)", "The value, or a fallback when it is #N/A.", "=IFNA(MATCH(\"x\", A1:A5, 0), \"missing\")";
    "IFS", "Logical", "IFS(condition1, value1, [condition2, value2], ...)", "The value for the first condition that holds.", "=IFS(A1>90, \"A\", A1>80, \"B\", TRUE, \"C\")";
    "INDEX", "Lookup", "INDEX(range, row, [column])", "The cell at a row and column of a range.", "=INDEX(A1:C5, 2, 3)";
    "INT", "Math", "INT(number)", "Rounds down to a whole number.", "=INT(7.8)";
    "ISBLANK", "Information", "ISBLANK(value)", "TRUE when the cell is empty.", "=ISBLANK(A1)";
    "ISERROR", "Information", "ISERROR(value)", "TRUE when the value is any error.", "=ISERROR(1/0)";
    "ISNA", "Information", "ISNA(value)", "TRUE when the value is #N/A.", "=ISNA(NA())";
    "ISNUMBER", "Information", "ISNUMBER(value)", "TRUE when the value is a number.", "=ISNUMBER(A1)";
    "ISTEXT", "Information", "ISTEXT(value)", "TRUE when the value is text.", "=ISTEXT(\"a\")";
    "LARGE", "Statistical", "LARGE(range, k)", "The k-th largest number.", "=LARGE(A1:A10, 2)";
    "LEFT", "Text", "LEFT(text, [count])", "The first characters of a text.", "=LEFT(\"Calimero\", 4)";
    "LEN", "Text", "LEN(text)", "How many characters a text has.", "=LEN(\"sheets\")";
    "LN", "Math", "LN(number)", "The natural logarithm.", "=LN(10)";
    "LOG", "Math", "LOG(number, [base])", "The logarithm in a base, 10 by default.", "=LOG(8, 2)";
    "LOG10", "Math", "LOG10(number)", "The base-10 logarithm.", "=LOG10(1000)";
    "LOWER", "Text", "LOWER(text)", "The text in lower case.", "=LOWER(\"ABC\")";
    "MATCH", "Lookup", "MATCH(value, range, [match_type])", "The position of a value in a row or column: 0 exact, 1 largest not above, -1 smallest not below.", "=MATCH(\"b\", A1:A5, 0)";
    "MAX", "Statistical", "MAX(value1, [value2], ...)", "The largest number.", "=MAX(A1:A10)";
    "MEDIAN", "Statistical", "MEDIAN(value1, [value2], ...)", "The middle number.", "=MEDIAN(1, 3, 2, 4)";
    "MID", "Text", "MID(text, start, count)", "Characters from the middle of a text.", "=MID(\"Calimero\", 3, 4)";
    "MIN", "Statistical", "MIN(value1, [value2], ...)", "The smallest number.", "=MIN(A1:A10)";
    "MINUTE", "Date", "MINUTE(time)", "The minute, 0 to 59.", "=MINUTE(NOW())";
    "MOD", "Math", "MOD(number, divisor)", "The remainder, with the divisor's sign.", "=MOD(10, 3)";
    "MONTH", "Date", "MONTH(date)", "The month, 1 to 12.", "=MONTH(TODAY())";
    "NA", "Information", "NA()", "The #N/A error, for a value that is not available.", "=NA()";
    "NOT", "Logical", "NOT(logical)", "The opposite logical value.", "=NOT(A1>5)";
    "NOW", "Date", "NOW()", "The current date and time (UTC).", "=NOW()";
    "OR", "Logical", "OR(logical1, [logical2], ...)", "TRUE when any argument is true.", "=OR(A1>5, B1>5)";
    "PI", "Math", "PI()", "The number pi.", "=PI()";
    "POWER", "Math", "POWER(base, exponent)", "A number raised to a power; the same as ^.", "=POWER(2, 10)";
    "PRODUCT", "Math", "PRODUCT(value1, [value2], ...)", "The numbers multiplied together.", "=PRODUCT(A1:A3)";
    "PROPER", "Text", "PROPER(text)", "Capitalises the first letter of each word.", "=PROPER(\"ada lovelace\")";
    "REPLACE", "Text", "REPLACE(text, start, count, new_text)", "Replaces characters at a position.", "=REPLACE(\"2025\", 4, 1, \"6\")";
    "REPT", "Text", "REPT(text, times)", "The text repeated.", "=REPT(\"*\", 5)";
    "RIGHT", "Text", "RIGHT(text, [count])", "The last characters of a text.", "=RIGHT(\"Calimero\", 4)";
    "ROUND", "Math", "ROUND(number, digits)", "Rounds to a number of decimal places, halves away from zero.", "=ROUND(2.675, 2)";
    "ROUNDDOWN", "Math", "ROUNDDOWN(number, digits)", "Rounds toward zero.", "=ROUNDDOWN(3.99, 1)";
    "ROUNDUP", "Math", "ROUNDUP(number, digits)", "Rounds away from zero.", "=ROUNDUP(3.01, 1)";
    "ROWS", "Lookup", "ROWS(range)", "How many rows a range has.", "=ROWS(A1:A10)";
    "SEARCH", "Text", "SEARCH(find_text, within_text, [start])", "Where text first appears, ignoring case; * and ? are wildcards.", "=SEARCH(\"L?O\", \"hello\")";
    "SECOND", "Date", "SECOND(time)", "The second, 0 to 59.", "=SECOND(NOW())";
    "SIGN", "Math", "SIGN(number)", "1, 0 or -1 by the number's sign.", "=SIGN(-3)";
    "SMALL", "Statistical", "SMALL(range, k)", "The k-th smallest number.", "=SMALL(A1:A10, 2)";
    "SQRT", "Math", "SQRT(number)", "The square root.", "=SQRT(16)";
    "STDEV", "Statistical", "STDEV(value1, [value2], ...)", "The sample standard deviation.", "=STDEV(A1:A10)";
    "SUBSTITUTE", "Text", "SUBSTITUTE(text, old, new, [instance])", "Replaces occurrences of a text, or only the n-th.", "=SUBSTITUTE(\"a-b-c\", \"-\", \"/\")";
    "SUM", "Math", "SUM(value1, [value2], ...)", "Adds the numbers.", "=SUM(A1:A10)";
    "SUMIF", "Math", "SUMIF(range, criterion, [sum_range])", "Adds the cells that meet a criterion.", "=SUMIF(A1:A10, \">0\")";
    "SUMIFS", "Math", "SUMIFS(sum_range, range1, criterion1, ...)", "Adds the cells that meet every criterion.", "=SUMIFS(C1:C10, A1:A10, \"East\", B1:B10, \">5\")";
    "SUMPRODUCT", "Math", "SUMPRODUCT(range1, [range2], ...)", "Multiplies ranges cell by cell and adds the products.", "=SUMPRODUCT(A1:A3, B1:B3)";
    "SWITCH", "Logical", "SWITCH(value, case1, result1, ..., [default])", "The result for the first case equal to the value.", "=SWITCH(A1, 1, \"one\", 2, \"two\", \"many\")";
    "TEXT", "Text", "TEXT(value, format)", "A number or date as text, e.g. \"#,##0.00\", \"0%\", \"yyyy-mm-dd\".", "=TEXT(1234.5, \"#,##0.00\")";
    "TEXTJOIN", "Text", "TEXTJOIN(delimiter, ignore_empty, text1, ...)", "Joins text with a delimiter.", "=TEXTJOIN(\", \", TRUE, A1:A5)";
    "TODAY", "Date", "TODAY()", "Today's date (UTC).", "=TODAY()";
    "TRIM", "Text", "TRIM(text)", "Removes extra spaces.", "=TRIM(\"  a   b  \")";
    "TRUE", "Logical", "TRUE()", "The logical value TRUE.", "=TRUE()";
    "TRUNC", "Math", "TRUNC(number, [digits])", "Cuts off decimals without rounding.", "=TRUNC(8.97, 1)";
    "UPPER", "Text", "UPPER(text)", "The text in upper case.", "=UPPER(\"abc\")";
    "VALUE", "Text", "VALUE(text)", "The number a text spells, such as \"1,234\" or \"12%\".", "=VALUE(\"12%\")";
    "VAR", "Statistical", "VAR(value1, [value2], ...)", "The sample variance.", "=VAR(A1:A10)";
    "VLOOKUP", "Lookup", "VLOOKUP(value, table, column, [approximate])", "Finds a value in a table's first column and returns the cell in the given column.", "=VLOOKUP(\"apple\", A1:C10, 3, FALSE)";
    "WEEKDAY", "Date", "WEEKDAY(date, [type])", "The day of the week: 1 = Sunday (type 1) or 1 = Monday (type 2).", "=WEEKDAY(TODAY())";
    "XLOOKUP", "Lookup", "XLOOKUP(value, lookup_range, return_range, [if_not_found], [match_mode], [search_mode])", "Finds a value in one range and returns the matching cell of another.", "=XLOOKUP(\"apple\", A1:A10, C1:C10, \"none\")";
    "XOR", "Logical", "XOR(logical1, [logical2], ...)", "TRUE when an odd number of arguments are true.", "=XOR(TRUE, FALSE)";
    "YEAR", "Date", "YEAR(date)", "The year.", "=YEAR(TODAY())";
};

#[cfg(test)]
mod tests {
    use super::*;

    /// A getter over `(row, col, value)` cells on the formula's own sheet.
    fn cells(list: &[(u32, u32, &str)]) -> impl Fn(Option<&str>, u32, u32) -> Option<String> {
        let map: BTreeMap<(u32, u32), String> = list
            .iter()
            .map(|(r, c, v)| ((*r, *c), v.to_string()))
            .collect();
        move |_s, r, c| map.get(&(r, c)).cloned()
    }

    fn none(_s: Option<&str>, _r: u32, _c: u32) -> Option<String> {
        None
    }

    #[test]
    fn if_tests_comparisons_not_text() {
        let gv = cells(&[(0, 0, "10")]);
        assert_eq!(evaluate("=IF(A1>5, \"big\", \"small\")", &gv), "big");
        assert_eq!(evaluate("=IF(A1<5, \"big\", \"small\")", &gv), "small");
        assert_eq!(evaluate("=IF(A1=10, 1, 0)", &gv), "1");
        assert_eq!(evaluate("=IF(A1>5, \"yes\")", &gv), "yes");
        assert_eq!(evaluate("=IF(A1>50, \"yes\")", &gv), "FALSE");
        // An error in the condition is the result, never "true".
        assert_eq!(evaluate("=IF(1/0>1, \"a\", \"b\")", &gv), "#DIV/0!");
        assert_eq!(evaluate("=IF(\"abc\", 1, 2)", &gv), "#VALUE!");
    }

    #[test]
    fn comparisons() {
        assert_eq!(evaluate("=1<2", none), "TRUE");
        assert_eq!(evaluate("=\"a\"=\"A\"", none), "TRUE");
        assert_eq!(evaluate("=\"b\">\"a\"", none), "TRUE");
        assert_eq!(evaluate("=2<>2", none), "FALSE");
        assert_eq!(evaluate("=\"x\">5", none), "TRUE");
        assert_eq!(evaluate("=3>=3", none), "TRUE");
        assert_eq!(evaluate("=A1=0", none), "TRUE");
    }

    #[test]
    fn division_by_zero() {
        let gv = cells(&[(0, 0, "4")]);
        assert_eq!(evaluate("=1/0", &gv), "#DIV/0!");
        assert_eq!(evaluate("=A1/B1", &gv), "#DIV/0!");
        assert_eq!(evaluate("=AVERAGE(C1:C3)", &gv), "#DIV/0!");
        assert_eq!(evaluate("=MOD(5, 0)", &gv), "#DIV/0!");
    }

    #[test]
    fn errors_propagate() {
        let gv = cells(&[(0, 0, "#DIV/0!"), (1, 0, "3")]);
        assert_eq!(evaluate("=A1+1", &gv), "#DIV/0!");
        assert_eq!(evaluate("=SUM(A1:A2)", &gv), "#DIV/0!");
        assert_eq!(evaluate("=\"x\"&A1", &gv), "#DIV/0!");
        assert_eq!(evaluate("=IFERROR(A1, 0)", &gv), "0");
        assert_eq!(evaluate("=ISERROR(A1)", &gv), "TRUE");
        assert_eq!(evaluate("=IFNA(A1, 0)", &gv), "#DIV/0!");
    }

    #[test]
    fn operators() {
        assert_eq!(evaluate("=2^3", none), "8");
        assert_eq!(evaluate("=-2^2", none), "4");
        assert_eq!(evaluate("=2^3^2", none), "64");
        assert_eq!(evaluate("=50%", none), "0.5");
        assert_eq!(evaluate("=\"a\"&\"b\"&1", none), "ab1");
        assert_eq!(evaluate("=1+2&3", none), "33");
        assert_eq!(evaluate("=0.1+0.2", none), "0.3");
        assert_eq!(evaluate("=10/4", none), "2.5");
        assert_eq!(evaluate("=1/3", none), "0.333333333333333");
        assert_eq!(evaluate("=1.5e3", none), "1500");
        assert_eq!(evaluate("=10^20", none), "1E+20");
        assert_eq!(evaluate("=\"say \"\"hi\"\"\"", none), "say \"hi\"");
        assert_eq!(evaluate("=TRUE+1", none), "2");
    }

    #[test]
    fn syntax_and_name_errors() {
        assert_eq!(evaluate("=1+", none), "#ERROR!");
        assert_eq!(evaluate("=SUM(1", none), "#ERROR!");
        assert_eq!(evaluate("=(1", none), "#ERROR!");
        assert_eq!(evaluate("=FOO(1)", none), "#NAME?");
        assert_eq!(evaluate("=nonsense", none), "#NAME?");
        assert_eq!(evaluate("=SUM()", none), "0");
        assert_eq!(evaluate("=ABS()", none), "#VALUE!");
        let deep = format!("={}1{}", "(".repeat(200), ")".repeat(200));
        assert_eq!(evaluate(&deep, none), "#ERROR!");
    }

    #[test]
    fn columns_beyond_z() {
        let gv = cells(&[(0, 26, "7"), (0, 25, "1"), (0, 27, "2")]);
        assert_eq!(evaluate("=AA1*2", &gv), "14");
        assert_eq!(evaluate("=aa1*2", &gv), "14");
        assert_eq!(evaluate("=SUM(Z1:AB1)", &gv), "10");
        assert_eq!(col_index("A"), Some(0));
        assert_eq!(col_index("Z"), Some(25));
        assert_eq!(col_index("AA"), Some(26));
        assert_eq!(col_index("ZZ"), Some(701));
        assert_eq!(col_index("AAA"), None);
        assert_eq!(col_label(0), "A");
        assert_eq!(col_label(26), "AA");
        assert_eq!(col_label(701), "ZZ");
        assert_eq!(precedents("=SUM(Z1:AB1)", "s").len(), 3);
    }

    #[test]
    fn conditional_aggregates() {
        let gv = cells(&[
            (0, 0, "5"),
            (1, 0, "10"),
            (2, 0, "15"),
            (3, 0, "x"),
            (0, 1, "1"),
            (1, 1, "2"),
            (2, 1, "3"),
            (3, 1, "4"),
        ]);
        assert_eq!(evaluate("=COUNTIF(A1:A4, \">5\")", &gv), "2");
        assert_eq!(evaluate("=SUMIF(A1:A4, \">=10\", B1:B4)", &gv), "5");
        assert_eq!(evaluate("=COUNTIF(A1:A4, \"x\")", &gv), "1");
        assert_eq!(evaluate("=COUNTIF(A1:A4, \"<>5\")", &gv), "3");
        assert_eq!(evaluate("=COUNTIF(A1:A4, 10)", &gv), "1");
        assert_eq!(
            evaluate("=COUNTIFS(A1:A4, \">1\", B1:B4, \"<3\")", &gv),
            "2"
        );
        assert_eq!(evaluate("=AVERAGEIF(A1:A4, \">0\")", &gv), "10");
        assert_eq!(
            evaluate("=SUMIFS(B1:B4, A1:A4, \">5\", A1:A4, \"<20\")", &gv),
            "5"
        );
        assert_eq!(evaluate("=COUNTIF(A1:A4, \"?\")", &gv), "1");
    }

    #[test]
    fn counts() {
        let gv = cells(&[(0, 0, "5"), (1, 0, "x"), (2, 0, "TRUE")]);
        assert_eq!(evaluate("=COUNT(A1:A5)", &gv), "1");
        assert_eq!(evaluate("=COUNTA(A1:A5)", &gv), "3");
        assert_eq!(evaluate("=COUNTBLANK(A1:A5)", &gv), "2");
        assert_eq!(evaluate("=COUNT(1, \"2\", \"x\")", &gv), "2");
    }

    #[test]
    fn lookups() {
        let gv = cells(&[
            (0, 0, "apple"),
            (0, 1, "1"),
            (1, 0, "banana"),
            (1, 1, "2"),
            (2, 0, "cherry"),
            (2, 1, "3"),
            (0, 3, "10"),
            (1, 3, "20"),
            (2, 3, "30"),
        ]);
        assert_eq!(evaluate("=VLOOKUP(\"banana\", A1:B3, 2, FALSE)", &gv), "2");
        assert_eq!(evaluate("=VLOOKUP(\"kiwi\", A1:B3, 2, FALSE)", &gv), "#N/A");
        assert_eq!(
            evaluate("=VLOOKUP(\"apple\", A1:B3, 5, FALSE)", &gv),
            "#REF!"
        );
        assert_eq!(evaluate("=MATCH(\"cher*\", A1:A3, 0)", &gv), "3");
        assert_eq!(evaluate("=MATCH(25, D1:D3)", &gv), "2");
        assert_eq!(evaluate("=MATCH(5, D1:D3)", &gv), "#N/A");
        assert_eq!(evaluate("=INDEX(A1:B3, 3, 1)", &gv), "cherry");
        assert_eq!(evaluate("=INDEX(A1:B3, 9, 1)", &gv), "#REF!");
        assert_eq!(evaluate("=XLOOKUP(\"apple\", A1:A3, B1:B3)", &gv), "1");
        assert_eq!(
            evaluate("=XLOOKUP(\"x\", A1:A3, B1:B3, \"none\")", &gv),
            "none"
        );
        assert_eq!(evaluate("=XLOOKUP(25, D1:D3, A1:A3, , -1)", &gv), "banana");
        assert_eq!(evaluate("=XLOOKUP(25, D1:D3, A1:A3, , 1)", &gv), "cherry");
        assert_eq!(evaluate("=HLOOKUP(10, D1:D3, 2, FALSE)", &gv), "20");
        assert_eq!(evaluate("=CHOOSE(2, \"a\", \"b\")", &gv), "b");
        assert_eq!(evaluate("=ROWS(A1:B3)&\"x\"&COLUMNS(A1:B3)", &gv), "3x2");
    }

    #[test]
    fn logic() {
        let gv = cells(&[(0, 0, "10")]);
        assert_eq!(evaluate("=AND(TRUE, 1)", &gv), "TRUE");
        assert_eq!(evaluate("=OR(FALSE, 0)", &gv), "FALSE");
        assert_eq!(evaluate("=XOR(TRUE, TRUE)", &gv), "FALSE");
        assert_eq!(evaluate("=NOT(0)", &gv), "TRUE");
        assert_eq!(evaluate("=IFS(A1>20, \"a\", A1>5, \"b\")", &gv), "b");
        assert_eq!(evaluate("=IFS(A1>20, \"a\")", &gv), "#N/A");
        assert_eq!(evaluate("=SWITCH(2, 1, \"one\", 2, \"two\")", &gv), "two");
        assert_eq!(evaluate("=SWITCH(9, 1, \"one\", \"other\")", &gv), "other");
    }

    #[test]
    fn math() {
        let gv = cells(&[(0, 0, "2"), (1, 0, "3"), (0, 1, "4"), (1, 1, "5")]);
        assert_eq!(evaluate("=ROUND(2.675, 2)", &gv), "2.68");
        assert_eq!(evaluate("=ROUND(-2.5, 0)", &gv), "-3");
        assert_eq!(evaluate("=ROUND(1234, -2)", &gv), "1200");
        assert_eq!(evaluate("=ROUNDUP(1.21, 1)", &gv), "1.3");
        assert_eq!(evaluate("=ROUNDDOWN(1.29, 1)", &gv), "1.2");
        assert_eq!(evaluate("=INT(-1.5)", &gv), "-2");
        assert_eq!(evaluate("=MOD(-7, 3)", &gv), "2");
        assert_eq!(evaluate("=SQRT(-1)", &gv), "#NUM!");
        assert_eq!(evaluate("=POWER(2, 10)", &gv), "1024");
        assert_eq!(evaluate("=SUMPRODUCT(A1:A2, B1:B2)", &gv), "23");
        assert_eq!(evaluate("=MEDIAN(1, 3, 2, 4)", &gv), "2.5");
        assert_eq!(evaluate("=LARGE(A1:B2, 1)", &gv), "5");
        assert_eq!(evaluate("=SMALL(A1:B2, 2)", &gv), "3");
        assert_eq!(evaluate("=VAR(1, 2, 3, 4)", &gv), "1.66666666666667");
        assert_eq!(evaluate("=CEILING(4.2, 0.5)", &gv), "4.5");
        assert_eq!(evaluate("=FLOOR(4.7, 0.5)", &gv), "4.5");
        assert_eq!(evaluate("=LOG(8, 2)", &gv), "3");
        assert_eq!(evaluate("=SUM(\"3\", TRUE)", &gv), "4");
    }

    #[test]
    fn text() {
        assert_eq!(evaluate("=LEFT(\"hello\", 2)", none), "he");
        assert_eq!(evaluate("=RIGHT(\"hello\", 3)", none), "llo");
        assert_eq!(evaluate("=MID(\"hello\", 2, 3)", none), "ell");
        assert_eq!(evaluate("=PROPER(\"ada lovelace\")", none), "Ada Lovelace");
        assert_eq!(evaluate("=TRIM(\"  a   b \")", none), "a b");
        assert_eq!(
            evaluate("=SUBSTITUTE(\"a-b-c\", \"-\", \"+\")", none),
            "a+b+c"
        );
        assert_eq!(
            evaluate("=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", 2)", none),
            "a-b+c"
        );
        assert_eq!(evaluate("=REPLACE(\"2025\", 4, 1, \"6\")", none), "2026");
        assert_eq!(evaluate("=FIND(\"l\", \"hello\")", none), "3");
        assert_eq!(evaluate("=FIND(\"L\", \"hello\")", none), "#VALUE!");
        assert_eq!(evaluate("=SEARCH(\"L?O\", \"hello\")", none), "3");
        assert_eq!(evaluate("=TEXT(1234.5, \"#,##0.00\")", none), "1,234.50");
        assert_eq!(evaluate("=TEXT(0.256, \"0.0%\")", none), "25.6%");
        assert_eq!(evaluate("=TEXT(-5, \"$0.00\")", none), "-$5.00");
        assert_eq!(evaluate("=TEXT(3.1, \"0.##\")", none), "3.1");
        assert_eq!(
            evaluate("=TEXTJOIN(\", \", TRUE, \"a\", \"\", \"b\")", none),
            "a, b"
        );
        assert_eq!(evaluate("=LEN(\"héllo\")", none), "5");
        assert_eq!(evaluate("=VALUE(\"1,234\")", none), "1234");
        assert_eq!(evaluate("=VALUE(\"12%\")", none), "0.12");
        assert_eq!(evaluate("=REPT(\"ab\", 3)", none), "ababab");
        assert_eq!(evaluate("=EXACT(\"a\", \"A\")", none), "FALSE");
        assert_eq!(evaluate("=CONCAT(\"Q\", 3, TRUE)", none), "Q3TRUE");
    }

    #[test]
    fn dates() {
        assert_eq!(evaluate("=DATE(2026, 9, 25)", none), "46290");
        assert_eq!(evaluate("=YEAR(46290)", none), "2026");
        assert_eq!(evaluate("=MONTH(46290)", none), "9");
        assert_eq!(evaluate("=DAY(46290)", none), "25");
        assert_eq!(evaluate("=WEEKDAY(46290)", none), "6");
        assert_eq!(evaluate("=WEEKDAY(46290, 2)", none), "5");
        assert_eq!(
            evaluate("=DATE(2026, 13, 1)=DATE(2027, 1, 1)", none),
            "TRUE"
        );
        assert_eq!(
            evaluate("=EOMONTH(DATE(2026, 2, 10), 0)=DATE(2026, 2, 28)", none),
            "TRUE"
        );
        assert_eq!(
            evaluate("=EDATE(DATE(2026, 1, 31), 1)=DATE(2026, 2, 28)", none),
            "TRUE"
        );
        assert_eq!(
            evaluate("=DAYS(DATE(2026, 12, 25), DATE(2026, 9, 25))", none),
            "91"
        );
        assert_eq!(evaluate("=TEXT(46290, \"yyyy-mm-dd\")", none), "2026-09-25");
        assert_eq!(
            evaluate("=TEXT(46290, \"d mmm yyyy\")", none),
            "25 Sep 2026"
        );
        assert_eq!(evaluate("=TEXT(46290, \"dddd\")", none), "Friday");
        assert_eq!(evaluate("=TEXT(46290.5625, \"hh:mm\")", none), "13:30");
        assert_eq!(evaluate("=YEAR(\"2026-09-25\")", none), "2026");
        assert_eq!(evaluate("=DATE(26, 1, 1)=DATE(1926, 1, 1)", none), "TRUE");

        // 2026-09-25T12:00:00Z.
        let env = Env {
            now_ms: 1_790_337_600_000,
            ..Env::default()
        };
        assert_eq!(evaluate_with("=TODAY()", &env, none), "46290");
        assert_eq!(evaluate_with("=NOW()", &env, none), "46290.5");
        assert_eq!(evaluate_with("=HOUR(NOW())", &env, none), "12");
    }

    #[test]
    fn named_ranges() {
        let gv = cells(&[(0, 1, "1"), (1, 1, "2"), (2, 1, "3")]);
        let env = Env {
            names: [("COSTS".to_string(), "B1:B3".to_string())].into(),
            ..Env::default()
        };
        assert_eq!(evaluate_with("=SUM(Costs)", &env, &gv), "6");
        assert_eq!(evaluate_with("=SUM(Other)", &env, &gv), "#NAME?");
        let mut p = precedents_with("=SUM(costs)", "s1", &env.names);
        p.sort();
        assert_eq!(
            p,
            vec![
                ("s1".into(), 0, 1),
                ("s1".into(), 1, 1),
                ("s1".into(), 2, 1)
            ]
        );
    }

    #[test]
    fn catalog_is_sorted_and_every_example_is_implemented() {
        assert!(CATALOG.windows(2).all(|w| w[0].name < w[1].name));
        for f in CATALOG {
            let out = evaluate(f.example, none);
            assert!(
                out != "#NAME?" && out != "#ERROR!",
                "{} example gave {out}",
                f.name
            );
            assert!(f.syntax.starts_with(f.name), "{} syntax", f.name);
            assert!(
                f.example.contains(&format!("{}(", f.name)),
                "{} example",
                f.name
            );
        }
    }

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
            vec![
                ("s1".into(), 0, 0),
                ("s1".into(), 1, 0),
                ("s1".into(), 2, 0)
            ]
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
        // A formula whose reference shifted out of range is stored as `=#REF!`;
        // it must display `#REF!`.
        assert_eq!(evaluate("=#REF!", none), "#REF!");
        assert_eq!(evaluate("=#DIV/0!", none), "#DIV/0!");
        assert_eq!(evaluate("=#NAME?", none), "#NAME?");
    }

    #[test]
    fn dollar_preserved_inside_string_literals() {
        // `$` is stripped only as an absolute-ref anchor — never inside a string.
        assert_eq!(evaluate("=\"$5\"", none), "$5");
        assert_eq!(evaluate("=\"Total $\"", none), "Total $");
        let gv1 = |_s: Option<&str>, _r: u32, _c: u32| Some("9".to_string());
        assert_eq!(evaluate("=$A$1", gv1), "9");
        assert_eq!(evaluate("=A$1+$A1", gv1), "18");
    }

    #[test]
    fn formula_arithmetic_literals() {
        assert_eq!(evaluate("=3+4", none), "7");
        assert_eq!(evaluate("=SUM(3+4)", none), "7");
        assert_eq!(evaluate("=10-4", none), "6");
        assert_eq!(evaluate("=2*3", none), "6");
        assert_eq!(evaluate("=8/2", none), "4");
        assert_eq!(evaluate("=(1+2)*3", none), "9");
        assert_eq!(evaluate("=2+3*4", none), "14"); // precedence
    }

    #[test]
    fn formula_whole_column_and_row_refs() {
        // Column A (col 0): A1=1, A2=2, A3=3.  Row 5 (index 4): B5=10, C5=20.
        let gv = cells(&[
            (0, 0, "1"),
            (1, 0, "2"),
            (2, 0, "3"),
            (4, 1, "10"),
            (4, 2, "20"),
        ]);
        assert_eq!(evaluate("=SUM(A:A)", &gv), "6");
        assert_eq!(evaluate("=COUNT(A:A)", &gv), "3");
        assert_eq!(evaluate("=AVERAGE(A:A)", &gv), "2");
        assert_eq!(evaluate("=MAX(A:A)", &gv), "3");
        assert_eq!(evaluate("=MIN(A:A)", &gv), "1");
        assert_eq!(evaluate("=SUM(5:5)", &gv), "30");
        assert_eq!(evaluate("=COUNT(5:5)", &gv), "2");
        assert_eq!(evaluate("=SUM(A:B)", &gv), "16");
    }

    #[test]
    fn formula_arithmetic_with_cells_and_args() {
        let gv = cells(&[(0, 0, "10"), (1, 0, "20")]);
        assert_eq!(evaluate("=A1+A2", &gv), "30");
        assert_eq!(evaluate("=A1*2", &gv), "20");
        assert_eq!(evaluate("=SUM(A1, A2, 5)", &gv), "35");
        assert_eq!(evaluate("=SUM(A1:A2)", &gv), "30");
        assert_eq!(evaluate("=SUM(A1:A2)+100", &gv), "130");
        assert_eq!(evaluate("=A3", &gv), "0");
    }

    #[test]
    fn format_num_is_fifteen_digits() {
        assert_eq!(format_num(2.5), "2.5");
        assert_eq!(format_num(-0.0), "0");
        assert_eq!(format_num(123_456_789_012_345.0), "123456789012345");
        assert_eq!(format_num(1e15), "1E+15");
        assert_eq!(format_num(1.5e-11), "1.5E-11");
        assert_eq!(format_num(0.000_1), "0.0001");
    }
}
