//! Integer money and calendar dates — the arithmetic every node must agree on
//! to the byte.
//!
//! Money is `i64` in minor units of the organisation's currency (cents).
//! Quantities are `u64` thousandths, so `1.5` hours is `1500`. Tax rates are
//! basis points, so 20% is `2000`. No floats anywhere: two nodes computing an
//! invoice total must produce the same number, and IEEE rounding is not a
//! thing to bet a balance sheet on.
//!
//! Dates are ISO `YYYY-MM-DD` strings. An accounting date is a calendar day,
//! not an instant — an invoice dated the 31st is dated the 31st in every time
//! zone — and the string form sorts correctly as bytes, so every period filter
//! is a string comparison.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

/// How a document's unit prices relate to tax.
pub const AMOUNT_MODES: [&str; 3] = ["exclusive", "inclusive", "none"];

/// The largest absolute line amount accepted, in minor units (10 trillion
/// cents). Bounds every sum far inside `i64` and is clamped on read too, since
/// a patched node can write any number.
pub const MAX_LINE_AMOUNT: i128 = 1_000_000_000_000_000;
/// 100% in basis points. A rate above it is clamped on read.
pub const MAX_TAX_BP: u32 = 10_000;

/// A stored document line. `tax_bp` is the rate captured when the line was
/// saved, so changing a tax rate later never rewrites a posted document.
#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Line {
    pub description: String,
    /// Thousandths of a unit.
    pub quantity: u64,
    /// Minor units per whole unit. Negative for a discount line.
    pub unit_price: i64,
    pub account_id: String,
    pub tax_rate_id: String,
    pub tax_bp: u32,
}

/// What a line comes to: net of tax, and the tax on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LineAmounts {
    pub net: i64,
    pub tax: i64,
}

/// Divide, rounding half away from zero (the convention on an invoice).
pub fn div_round(n: i128, d: i128) -> i128 {
    debug_assert!(d > 0);
    if n >= 0 {
        (n + d / 2) / d
    } else {
        -((-n + d / 2) / d)
    }
}

/// `quantity × unit_price`, before tax treatment, clamped to the accepted range.
pub fn gross(quantity: u64, unit_price: i64) -> i128 {
    div_round(i128::from(quantity) * i128::from(unit_price), 1000)
        .clamp(-MAX_LINE_AMOUNT, MAX_LINE_AMOUNT)
}

/// One line's net and tax under the document's amount mode.
///
/// - `exclusive`: the price is net; tax is added on top.
/// - `inclusive`: the price already contains the tax; it is backed out.
/// - `none`: no tax at all, whatever the line's rate says.
pub fn line_amounts(line: &Line, mode: &str) -> LineAmounts {
    let g = gross(line.quantity, line.unit_price);
    let bp = i128::from(line.tax_bp.min(MAX_TAX_BP));
    let (net, tax) = match mode {
        "inclusive" => {
            let tax = div_round(g * bp, 10_000 + bp);
            (g - tax, tax)
        }
        "none" => (g, 0),
        _ => (g, div_round(g * bp, 10_000)),
    };
    // Both are bounded by MAX_LINE_AMOUNT, which fits i64.
    LineAmounts {
        net: net as i64,
        tax: tax as i64,
    }
}

/// A document's subtotal, tax and total.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Totals {
    pub subtotal: i64,
    pub tax: i64,
    pub total: i64,
}

pub fn totals(lines: &[Line], mode: &str) -> Totals {
    let mut t = Totals::default();
    for l in lines {
        let a = line_amounts(l, mode);
        t.subtotal = t.subtotal.saturating_add(a.net);
        t.tax = t.tax.saturating_add(a.tax);
    }
    t.total = t.subtotal.saturating_add(t.tax);
    t
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/// `(year, month, day)` of a valid `YYYY-MM-DD`, or `None`.
pub fn parse_date(s: &str) -> Option<(i32, u32, u32)> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        s.get(r.clone())
            .filter(|p| p.bytes().all(|c| c.is_ascii_digit()))?
            .parse()
            .ok()
    };
    let y = digits(0..4)? as i32;
    let m = digits(5..7)?;
    let d = digits(8..10)?;
    if !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m) || y < 1900 {
        return None;
    }
    Some((y, m, d))
}

pub fn is_date(s: &str) -> bool {
    parse_date(s).is_some()
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        _ => 28,
    }
}

/// Days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
pub fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = i64::from(y) - i64::from(m <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `b - a` in days, for two valid dates; 0 if either is malformed.
pub fn days_between(a: &str, b: &str) -> i64 {
    match (parse_date(a), parse_date(b)) {
        (Some((ya, ma, da)), Some((yb, mb, db))) => {
            days_from_civil(yb, mb, db) - days_from_civil(ya, ma, da)
        }
        _ => 0,
    }
}

/// `YYYY-MM-DD` for a day count since the epoch (inverse of `days_from_civil`).
pub fn civil_from_days(z: i64) -> String {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The first day of the financial year containing `date`, for a year that
/// ends in `fy_end_month` (12 = calendar year, 6 = July–June, …).
pub fn fy_start(date: &str, fy_end_month: u32) -> String {
    let (y, m, _) = parse_date(date).unwrap_or((1970, 1, 1));
    let start_month = fy_end_month.clamp(1, 12) % 12 + 1;
    let year = if m >= start_month { y } else { y - 1 };
    format!("{year:04}-{start_month:02}-01")
}

/// The day before a valid date.
pub fn day_before(date: &str) -> String {
    match parse_date(date) {
        Some((y, m, d)) => civil_from_days(days_from_civil(y, m, d) - 1),
        None => date.to_string(),
    }
}

/// The `YYYY-MM` months ending with the month of `date`, oldest first.
pub fn trailing_months(date: &str, count: u32) -> Vec<String> {
    let (mut y, mut m, _) = parse_date(date).unwrap_or((1970, 1, 1));
    let mut out = Vec::with_capacity(count as usize);
    for _ in 0..count {
        out.push(format!("{y:04}-{m:02}"));
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(quantity: u64, unit_price: i64, tax_bp: u32) -> Line {
        Line {
            description: String::new(),
            quantity,
            unit_price,
            account_id: "acc-sales".into(),
            tax_rate_id: "tax-standard".into(),
            tax_bp,
        }
    }

    #[test]
    fn exclusive_inclusive_and_untaxed_lines() {
        // 2.5 × 10.00 at 20%: net 25.00, tax 5.00.
        let l = line(2_500, 1_000, 2_000);
        assert_eq!(
            line_amounts(&l, "exclusive"),
            LineAmounts {
                net: 2_500,
                tax: 500
            }
        );
        // 120.00 inclusive of 20% is 100.00 + 20.00.
        let l = line(1_000, 12_000, 2_000);
        assert_eq!(
            line_amounts(&l, "inclusive"),
            LineAmounts {
                net: 10_000,
                tax: 2_000
            }
        );
        assert_eq!(
            line_amounts(&l, "none"),
            LineAmounts {
                net: 12_000,
                tax: 0
            }
        );
    }

    #[test]
    fn rounding_is_half_away_from_zero() {
        assert_eq!(div_round(5, 10), 1);
        assert_eq!(div_round(-5, 10), -1);
        assert_eq!(div_round(4, 10), 0);
        // 0.333 × 1.00 = 0.333 → 0.33; tax at 15% of 33 = 4.95 → 5.
        let l = line(333, 100, 1_500);
        assert_eq!(
            line_amounts(&l, "exclusive"),
            LineAmounts { net: 33, tax: 5 }
        );
    }

    #[test]
    fn hostile_numbers_are_clamped() {
        let l = line(u64::MAX, i64::MAX, u32::MAX);
        let a = line_amounts(&l, "exclusive");
        assert_eq!(i128::from(a.net), MAX_LINE_AMOUNT);
        assert_eq!(a.tax, a.net); // the rate is clamped to 100%
    }

    #[test]
    fn totals_add_discount_lines() {
        let t = totals(
            &[line(1_000, 10_000, 1_000), line(1_000, -1_000, 1_000)],
            "exclusive",
        );
        assert_eq!(
            t,
            Totals {
                subtotal: 9_000,
                tax: 900,
                total: 9_900
            }
        );
    }

    #[test]
    fn dates_parse_and_count() {
        assert!(is_date("2024-02-29"));
        assert!(!is_date("2023-02-29"));
        assert!(!is_date("2024-13-01"));
        assert!(!is_date("2024-1-01"));
        assert!(!is_date("+024-01-01"));
        assert_eq!(days_between("2024-01-01", "2024-03-01"), 60);
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), "2024-02-29");
        assert_eq!(day_before("2024-03-01"), "2024-02-29");
    }

    #[test]
    fn financial_years() {
        assert_eq!(fy_start("2024-05-10", 12), "2024-01-01");
        // A July–June year.
        assert_eq!(fy_start("2024-05-10", 6), "2023-07-01");
        assert_eq!(fy_start("2024-07-01", 6), "2024-07-01");
        // An April–March year.
        assert_eq!(fy_start("2025-03-31", 3), "2024-04-01");
    }

    #[test]
    fn trailing_months_cross_a_year() {
        assert_eq!(
            trailing_months("2024-02-15", 3),
            ["2023-12", "2024-01", "2024-02"]
        );
    }
}
