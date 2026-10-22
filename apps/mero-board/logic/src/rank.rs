//! Fractional-index ranks. A rank is a base-36 fraction in (0, 1) written
//! with the digits `0-9a-z`, never empty and never ending in `0`. Readers sort
//! siblings by `(rank, id)`. The same algorithm lives in the app
//! (`app/src/utils/rank.ts`) and the MCP server (`mcp/src/rank.ts`): the
//! contract only needs it to append, clients compute "between".

use board_types::Error;

pub const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Non-empty, only `0-9a-z`, no trailing `0`.
pub fn validate_rank(rank: &str) -> Result<(), Error> {
    if rank.is_empty() {
        return Err(Error::Invalid("rank must not be empty".into()));
    }
    if !rank.bytes().all(|b| DIGITS.contains(&b)) {
        return Err(Error::Invalid("rank must use only 0-9a-z".into()));
    }
    if rank.ends_with('0') {
        return Err(Error::Invalid("rank must not end in 0".into()));
    }
    Ok(())
}

fn digit(b: u8) -> usize {
    DIGITS
        .iter()
        .position(|d| *d == b)
        .expect("validated digit")
}

/// A rank strictly between `a` (exclusive, `""` = 0) and `b` (`None` = 1).
/// Both must already be valid (or empty / None) and `a < b`.
fn midpoint(a: &str, b: Option<&str>) -> String {
    if let Some(b) = b {
        assert!(a < b, "midpoint needs a < b");
        let mut n = 0;
        let ab = a.as_bytes();
        let bb = b.as_bytes();
        while n < bb.len() && ab.get(n).copied().unwrap_or(b'0') == bb[n] {
            n += 1;
        }
        if n > 0 {
            let a_rest = if n < ab.len() { &a[n..] } else { "" };
            return format!("{}{}", &b[..n], midpoint(a_rest, Some(&b[n..])));
        }
    }
    let digit_a = a.bytes().next().map(digit).unwrap_or(0);
    let digit_b = b
        .and_then(|b| b.bytes().next())
        .map(digit)
        .unwrap_or(DIGITS.len());
    if digit_b - digit_a > 1 {
        let mid = (digit_a + digit_b).div_ceil(2);
        return (DIGITS[mid] as char).to_string();
    }
    if let Some(b) = b {
        if b.len() > 1 {
            return b[..1].to_string();
        }
    }
    let a_rest = if a.is_empty() { "" } else { &a[1..] };
    format!("{}{}", DIGITS[digit_a] as char, midpoint(a_rest, None))
}

/// A rank between two neighbours; `None` on either side means the edge.
pub fn rank_between(before: Option<&str>, after: Option<&str>) -> String {
    midpoint(before.unwrap_or(""), after)
}

/// A rank after the current last sibling (or the first rank when there is none).
pub fn rank_after(last: Option<&str>) -> String {
    rank_between(last, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_rank_is_the_middle_digit() {
        assert_eq!(rank_after(None), "i");
    }

    #[test]
    fn appending_always_sorts_after() {
        let mut last: Option<String> = None;
        for _ in 0..200 {
            let next = rank_after(last.as_deref());
            validate_rank(&next).unwrap();
            if let Some(prev) = &last {
                assert!(next.as_str() > prev.as_str(), "{next} > {prev}");
            }
            last = Some(next);
        }
    }

    #[test]
    fn between_sorts_strictly_between() {
        let mut lo = "i".to_string();
        let hi = "r".to_string();
        for _ in 0..200 {
            let mid = rank_between(Some(&lo), Some(&hi));
            validate_rank(&mid).unwrap();
            assert!(
                lo.as_str() < mid.as_str() && mid.as_str() < hi.as_str(),
                "{lo} < {mid} < {hi}"
            );
            lo = mid;
        }
    }

    #[test]
    fn prepending_sorts_before() {
        let mut hi = "i".to_string();
        for _ in 0..200 {
            let before = rank_between(None, Some(&hi));
            validate_rank(&before).unwrap();
            assert!(before.as_str() < hi.as_str());
            hi = before;
        }
    }

    #[test]
    fn rank_validation_rejects_bad_ranks() {
        assert!(validate_rank("").is_err());
        assert!(validate_rank("A").is_err());
        assert!(validate_rank("a0").is_err());
        assert!(validate_rank("a\u{1}").is_err());
        assert!(validate_rank("i").is_ok());
        assert!(validate_rank("zz9").is_ok());
    }
}
