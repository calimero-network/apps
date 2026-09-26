//! Conditions for conditional formatting and data validation.
//!
//! One evaluator for both homes: the contract checks a strict validation on
//! write, and the browser (through `recalc-wasm`) colours cells and marks
//! invalid ones, so the two can never disagree about what a rule means.
//!
//! A condition tests a cell's value (its computed value, as text) against the
//! rule's arguments. Numbers compare as numbers; text compares without regard
//! to case.

/// Every condition, with how many arguments it takes.
pub const CONDITIONS: &[(&str, usize)] = &[
    ("empty", 0),
    ("not_empty", 0),
    ("eq", 1),
    ("ne", 1),
    ("gt", 1),
    ("gte", 1),
    ("lt", 1),
    ("lte", 1),
    ("between", 2),
    ("not_between", 2),
    ("contains", 1),
    ("not_contains", 1),
    ("starts_with", 1),
    ("ends_with", 1),
    ("one_of", usize::MAX),
    ("is_number", 0),
    ("checkbox", 0),
];

/// Whether `args` suit `condition`: a known condition with the right number
/// of arguments (`one_of` takes at least one), numbers where it compares
/// numbers.
pub fn is_valid(condition: &str, args: &[String]) -> bool {
    let Some(&(_, n)) = CONDITIONS.iter().find(|(c, _)| *c == condition) else {
        return false;
    };
    let count_ok = if n == usize::MAX {
        !args.is_empty()
    } else {
        args.len() == n
    };
    let numeric = matches!(
        condition,
        "gt" | "gte" | "lt" | "lte" | "between" | "not_between"
    );
    count_ok && (!numeric || args.iter().all(|a| number(a).is_some()))
}

/// Whether `value` meets `condition` with `args`. An unknown condition, or
/// the wrong arguments, never matches.
pub fn matches(condition: &str, args: &[String], value: &str) -> bool {
    if !is_valid(condition, args) {
        return false;
    }
    let v = value.trim();
    let arg = |i: usize| args.get(i).map(|s| s.trim()).unwrap_or("");
    let num = |i: usize| number(arg(i));
    let same = |a: &str, b: &str| match (number(a), number(b)) {
        (Some(x), Some(y)) => x == y,
        _ => a.to_lowercase() == b.to_lowercase(),
    };
    let lower = v.to_lowercase();
    match condition {
        "empty" => v.is_empty(),
        "not_empty" => !v.is_empty(),
        "eq" => same(v, arg(0)),
        "ne" => !same(v, arg(0)),
        "gt" => cmp(v, num(0)).is_some_and(|o| o.is_gt()),
        "gte" => cmp(v, num(0)).is_some_and(|o| o.is_ge()),
        "lt" => cmp(v, num(0)).is_some_and(|o| o.is_lt()),
        "lte" => cmp(v, num(0)).is_some_and(|o| o.is_le()),
        "between" | "not_between" => {
            let (Some(x), Some(a), Some(b)) = (number(v), num(0), num(1)) else {
                return false;
            };
            let inside = a.min(b) <= x && x <= a.max(b);
            inside == (condition == "between")
        }
        "contains" => lower.contains(&arg(0).to_lowercase()),
        "not_contains" => !lower.contains(&arg(0).to_lowercase()),
        "starts_with" => lower.starts_with(&arg(0).to_lowercase()),
        "ends_with" => lower.ends_with(&arg(0).to_lowercase()),
        "one_of" => args.iter().any(|a| same(v, a.trim())),
        "is_number" => number(v).is_some(),
        "checkbox" => matches!(lower.as_str(), "" | "true" | "false"),
        _ => false,
    }
}

/// What a value must be, for a refusal message: "a number between 1 and 10".
pub fn describe(condition: &str, args: &[String]) -> String {
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    match condition {
        "empty" => "empty".into(),
        "not_empty" => "not empty".into(),
        "eq" => format!("equal to {}", arg(0)),
        "ne" => format!("anything but {}", arg(0)),
        "gt" => format!("a number greater than {}", arg(0)),
        "gte" => format!("a number of at least {}", arg(0)),
        "lt" => format!("a number less than {}", arg(0)),
        "lte" => format!("a number of at most {}", arg(0)),
        "between" => format!("a number between {} and {}", arg(0), arg(1)),
        "not_between" => format!("a number outside {} to {}", arg(0), arg(1)),
        "contains" => format!("text containing {:?}", arg(0)),
        "not_contains" => format!("text without {:?}", arg(0)),
        "starts_with" => format!("text starting with {:?}", arg(0)),
        "ends_with" => format!("text ending with {:?}", arg(0)),
        "one_of" => format!("one of {}", args.join(", ")),
        "is_number" => "a number".into(),
        "checkbox" => "TRUE or FALSE".into(),
        other => other.into(),
    }
}

fn number(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

fn cmp(v: &str, against: Option<f64>) -> Option<std::cmp::Ordering> {
    number(v)?.partial_cmp(&against?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn numbers_compare_as_numbers() {
        assert!(matches("gt", &a(&["9"]), "10"));
        assert!(!matches("gt", &a(&["9"]), "abc"));
        assert!(matches("between", &a(&["10", "1"]), "5"));
        assert!(matches("not_between", &a(&["1", "10"]), "11"));
        assert!(matches("eq", &a(&["1.0"]), "1"));
        assert!(matches("lte", &a(&["3"]), " 3 "));
    }

    #[test]
    fn text_compares_without_case() {
        assert!(matches("eq", &a(&["Done"]), "done"));
        assert!(matches("contains", &a(&["OVER"]), "over budget"));
        assert!(matches("starts_with", &a(&["q"]), "Q3"));
        assert!(matches("one_of", &a(&["Yes", "No"]), "no"));
        assert!(!matches("one_of", &a(&["Yes", "No"]), "maybe"));
    }

    #[test]
    fn emptiness_numbers_and_checkboxes() {
        assert!(matches("empty", &[], "  "));
        assert!(matches("not_empty", &[], "x"));
        assert!(matches("is_number", &[], "-2.5"));
        assert!(!matches("is_number", &[], "1e999"));
        assert!(matches("checkbox", &[], "TRUE"));
        assert!(!matches("checkbox", &[], "yes"));
    }

    #[test]
    fn bad_rules_never_match() {
        assert!(!is_valid("gt", &a(&["x"])));
        assert!(!is_valid("between", &a(&["1"])));
        assert!(!is_valid("one_of", &[]));
        assert!(!is_valid("sparkles", &[]));
        assert!(!matches("gt", &a(&["x"]), "5"));
    }

    #[test]
    fn describes_what_is_expected() {
        assert_eq!(
            describe("between", &a(&["1", "10"])),
            "a number between 1 and 10"
        );
        assert_eq!(describe("one_of", &a(&["Yes", "No"])), "one of Yes, No");
    }
}
