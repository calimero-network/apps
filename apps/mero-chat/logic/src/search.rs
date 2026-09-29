//! What a message search compares, and what it hands back.
//!
//! A search folds both sides the way mero-docs' `foldForSearch` does (NFKD,
//! lowercase, final sigma, combining marks dropped), so "cafe" finds "Café"
//! and "ﬁle" finds "file", and it matches the text a reader SEES: message text
//! is editor HTML, and matching the raw markup made "strong", "span" or "p"
//! hit nearly every message.
//!
//! The NFKD half is a table over the Latin, Greek and Cyrillic blocks (see
//! `fold_table`); in other scripts a fold only lowercases and drops the
//! common combining marks. Query and text always fold the same way, so that
//! bounds what an accent-insensitive match covers, never whether a match is
//! found for the exact text.
//!
//! The expensive half, the snippet, is only ever built for a hit a call
//! returns; the scan itself costs one plain-text pass and one fold per message.

mod fold_table;

/// Characters of context kept before a match in a snippet.
const SNIPPET_BEFORE: usize = 40;
/// Most characters a snippet holds, match included (the match itself is never
/// cut, so a snippet of a long match can be longer).
const SNIPPET_LEN: usize = 160;
const ELLIPSIS: char = '\u{2026}';

/// Where a search resumes, as an opaque string for the client to hand back.
///
/// The channel is walked newest first by POSITION, each top-level message
/// followed by its thread, so a position plus a place in that thread is all
/// a resume needs. Positions are stable (appends land after them and a delete
/// keeps its slot), so a cursor stays valid however much is sent meanwhile;
/// what arrives after the first page is newer than the walk and is not in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Cursor {
    /// The top-level message the walk is at.
    pub index: usize,
    pub step: Step,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Step {
    /// The message at `index` itself is next.
    Message,
    /// The message is done; its replies are next, after the reply with this
    /// id when there is one.
    Replies(Option<String>),
}

impl Cursor {
    pub(crate) fn encode(&self) -> String {
        match &self.step {
            Step::Message => self.index.to_string(),
            Step::Replies(None) => format!("{}:", self.index),
            Step::Replies(Some(after)) => format!("{}:{after}", self.index),
        }
    }

    pub(crate) fn decode(raw: &str) -> Option<Self> {
        let (index, step) = match raw.split_once(':') {
            None => (raw, Step::Message),
            Some((index, "")) => (index, Step::Replies(None)),
            Some((index, after)) => (index, Step::Replies(Some(after.to_owned()))),
        };
        Some(Self {
            index: index.parse().ok()?,
            step,
        })
    }
}

/// The combining-mark blocks a fold drops outside the table's blocks.
const MARKS: &[(u32, u32)] = &[
    (0x0300, 0x036F),
    (0x0483, 0x0489),
    (0x1AB0, 0x1AFF),
    (0x1DC0, 0x1DFF),
    (0x20D0, 0x20FF),
    (0xFE20, 0xFE2F),
];

fn in_ranges(c: char, ranges: &[(u32, u32)]) -> bool {
    let cp = c as u32;
    ranges.iter().any(|&(lo, hi)| (lo..=hi).contains(&cp))
}

/// One character, folded; appended to `out`.
fn push_folded(c: char, out: &mut String) {
    if c.is_ascii() {
        out.push(c.to_ascii_lowercase());
        return;
    }
    if let Ok(at) = fold_table::FOLDS.binary_search_by_key(&c, |&(from, _)| from) {
        out.push_str(fold_table::FOLDS[at].1);
        return;
    }
    // Full-width ASCII is NFKD-equal to ASCII.
    if let Some(ascii) = (c as u32)
        .checked_sub(0xFEE0)
        .filter(|cp| (0x21..=0x7E).contains(cp))
        .and_then(char::from_u32)
    {
        out.push(ascii.to_ascii_lowercase());
        return;
    }
    for l in c.to_lowercase() {
        if in_ranges(l, MARKS) {
            continue;
        }
        // Lowercasing a whole string yields a final sigma at word ends;
        // per character it never does, so both spellings meet at σ.
        out.push(if l == 'ς' { 'σ' } else { l });
    }
}

/// Case, accent and width folded, as mero-docs' `foldForSearch`.
pub(crate) fn fold(s: &str) -> String {
    if s.is_ascii() {
        return s.to_ascii_lowercase();
    }
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        push_folded(c, &mut out);
    }
    out
}

/// A query as a search compares it: whitespace runs collapsed, trimmed, folded.
/// Empty when there is nothing to look for.
pub(crate) fn fold_query(query: &str) -> String {
    fold(&query.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Tags that end a line of text, read as a space so "a</p><p>b" is "a b".
fn is_block_tag(tag: &str) -> bool {
    let name = tag
        .trim_start_matches('/')
        .split(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .next()
        .unwrap_or("");
    [
        "br",
        "p",
        "div",
        "li",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    ]
    .iter()
    .any(|block| name.eq_ignore_ascii_case(block))
}

/// The character an entity body (between `&` and `;`) stands for.
fn entity(body: &str) -> Option<char> {
    Some(match body {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" | "#39" => '\'',
        "nbsp" => ' ',
        _ => {
            let num = body.strip_prefix('#')?;
            let code = match num.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => num.parse().ok()?,
            };
            char::from_u32(code)?
        }
    })
}

/// The text a reader sees in message HTML: tags dropped (block ones as a
/// space), the common entities decoded, whitespace collapsed and trimmed.
/// A `<` that does not open a tag is text, as a browser shows it.
pub(crate) fn plain_text(html: &str) -> String {
    visible_text(html, false)
}

/// `fold(&plain_text(html))` in one pass, for the scan: what every message a
/// search reads costs.
pub(crate) fn folded_text(html: &str) -> String {
    visible_text(html, true)
}

fn visible_text(html: &str, folded: bool) -> String {
    let mut out = String::with_capacity(html.len());
    let mut pending_space = false;
    let mut push = |c: char, out: &mut String| {
        if c.is_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            if folded {
                push_folded(c, out);
            } else {
                out.push(c);
            }
        }
    };
    let mut rest = html;
    while let Some(c) = rest.chars().next() {
        let opens_tag = || {
            rest[1..]
                .chars()
                .next()
                .is_some_and(|n| n.is_ascii_alphabetic() || n == '/' || n == '!')
        };
        if c == '<' && opens_tag() {
            if let Some(end) = rest.find('>') {
                if is_block_tag(&rest[1..end]) {
                    push(' ', &mut out);
                }
                rest = &rest[end + 1..];
                continue;
            }
        } else if c == '&' {
            // Entities are short; a `;` further away is not this one's.
            let decoded = rest[1..]
                .char_indices()
                .take(10)
                .find(|&(_, ch)| ch == ';')
                .and_then(|(semi, _)| Some((entity(&rest[1..1 + semi])?, semi)));
            if let Some((ch, semi)) = decoded {
                push(ch, &mut out);
                rest = &rest[semi + 2..];
                continue;
            }
        }
        push(c, &mut out);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// A short excerpt of `plain` around the first match of `needle` (already
/// folded), and the match's place in it in UTF-16 units, which is how a
/// browser indexes a string. The excerpt is plain text, never markup.
pub(crate) struct Snippet {
    pub text: String,
    pub match_start: u32,
    pub match_end: u32,
}

pub(crate) fn snippet(plain: &str, needle: &str) -> Snippet {
    // Folded text plus, per folded byte, the plain character it came from.
    let chars: Vec<char> = plain.chars().collect();
    let mut folded = String::with_capacity(plain.len());
    let mut origin: Vec<usize> = Vec::with_capacity(plain.len());
    for (i, &c) in chars.iter().enumerate() {
        push_folded(c, &mut folded);
        origin.resize(folded.len(), i);
    }

    let (first, last) = match folded.find(needle).filter(|_| !needle.is_empty()) {
        Some(at) => {
            let first = origin[at];
            let mut last = origin[at + needle.len() - 1];
            // A character that folds to nothing (a combining mark) belongs to
            // the one before it.
            while last + 1 < chars.len() && {
                let mut probe = String::new();
                push_folded(chars[last + 1], &mut probe);
                probe.is_empty()
            } {
                last += 1;
            }
            (first, last + 1)
        }
        None => (0, 0),
    };

    let start = first.saturating_sub(SNIPPET_BEFORE);
    let end = chars.len().min(last.max(start.saturating_add(SNIPPET_LEN)));

    let mut text = String::new();
    let mut units = 0u32;
    let mut match_start = 0;
    let mut match_end = 0;
    if start > 0 {
        text.push(ELLIPSIS);
        units += 1;
    }
    for (i, &c) in chars.iter().enumerate().take(end).skip(start) {
        if i == first {
            match_start = units;
        }
        text.push(c);
        units += c.len_utf16() as u32;
        if i + 1 == last {
            match_end = units;
        }
    }
    if first == last {
        match_start = 0;
        match_end = 0;
    }
    if end < chars.len() {
        text.push(ELLIPSIS);
    }
    Snippet {
        text,
        match_start,
        match_end,
    }
}

#[cfg(test)]
mod tests {
    use unicode_normalization::char::is_combining_mark;
    use unicode_normalization::UnicodeNormalization;

    use super::{fold, fold_query, fold_table, folded_text, plain_text, snippet, Cursor, Step};

    /// NFKD, lowercase, final sigma to σ, marks dropped: `foldForSearch`.
    fn nfkd_fold(c: char) -> String {
        let mut out = String::new();
        for d in core::iter::once(c).nfkd() {
            for l in d.to_lowercase() {
                if !is_combining_mark(l) {
                    out.push(if l == 'ς' { 'σ' } else { l });
                }
            }
        }
        out
    }

    /// Over every character of the covered blocks, the table-driven fold is
    /// exactly `foldForSearch`'s; the failure prints the table to paste.
    #[test]
    fn the_fold_table_is_nfkd() {
        let mut want = String::new();
        let mut wrong = Vec::new();
        for &(lo, hi) in fold_table::COVERED {
            for c in (lo..=hi).filter_map(char::from_u32) {
                let expected = nfkd_fold(c);
                if is_combining_mark(c) {
                    assert_eq!(fold(&c.to_string()), "", "{c:?} is a mark");
                    continue;
                }
                let lowered: String = c
                    .to_lowercase()
                    .map(|l| if l == 'ς' { 'σ' } else { l })
                    .collect();
                if expected != lowered {
                    want.push_str(&format!("    ('\\u{{{:04x}}}', {expected:?}),\n", c as u32));
                }
                if fold(&c.to_string()) != expected {
                    wrong.push(c);
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "{} characters fold wrong, e.g. {:?}; the table should be:\n{want}",
            wrong.len(),
            &wrong[..wrong.len().min(5)]
        );
        // Full-width forms, outside the table, by arithmetic.
        for c in ('\u{ff01}'..='\u{ff5e}').chain(['\u{0301}', '\u{0483}']) {
            assert_eq!(fold(&c.to_string()), nfkd_fold(c), "{c:?}");
        }
    }

    /// The same folds mero-docs' `foldForSearch` makes, case by case.
    #[test]
    fn folds_like_the_docs_client() {
        assert_eq!(fold("Café"), "cafe");
        assert_eq!(fold("CAFE\u{301}"), "cafe"); // decomposed input
        assert_eq!(fold("ﬁle"), "file"); // ligature, NFKD
        assert_eq!(fold("ＡＢＣ"), "abc"); // full width
        assert_eq!(fold("ΟΔΟΣ"), "οδοσ"); // final sigma meets σ
        assert_eq!(fold("οδος"), "οδοσ");
        assert_eq!(fold("İstanbul"), "istanbul");
        assert_eq!(fold("Straße"), "straße"); // no case folding past lowercase
        assert_eq!(fold("plain ascii"), "plain ascii");
    }

    #[test]
    fn the_scan_folds_what_the_snippet_shows() {
        for html in [
            "<p>Hello <b>Wörld</b>&nbsp;&amp; ΟΔΟΣ</p>",
            "plain",
            "  a \n\t b  ",
            "<ul><li>one</li><li>two</li></ul>",
        ] {
            assert_eq!(folded_text(html), fold(&plain_text(html)), "{html:?}");
        }
    }

    #[test]
    fn a_query_is_trimmed_and_its_whitespace_collapsed() {
        assert_eq!(fold_query("  Hello \t  Wörld "), "hello world");
        assert_eq!(fold_query("   "), "");
    }

    #[test]
    fn plain_text_is_what_a_reader_sees() {
        assert_eq!(
            plain_text("<p>hi <strong>there</strong></p><p>second&nbsp;line</p>"),
            "hi there second line"
        );
        assert_eq!(
            plain_text("a&amp;b &lt;tag&gt; &#233;&#x41;"),
            "a&b <tag> éA"
        );
        // Not an entity, and a `<` that opens no tag is text.
        assert_eq!(plain_text("AT&T 3 < 4"), "AT&T 3 < 4");
        assert_eq!(plain_text("3 < 4 and 5 > 2"), "3 < 4 and 5 > 2");
        assert_eq!(plain_text("x <b"), "x <b");
        assert_eq!(plain_text("a<br/>b"), "a b");
        assert_eq!(
            plain_text(r#"<span class="mention mention-user-x">@ana</span> ok"#),
            "@ana ok"
        );
    }

    #[test]
    fn the_snippet_marks_the_match_in_utf16_units() {
        let s = snippet("Meet at the café tomorrow", &fold("CAFE"));
        assert_eq!(s.text, "Meet at the café tomorrow");
        let units: Vec<u16> = s.text.encode_utf16().collect();
        let marked =
            String::from_utf16(&units[s.match_start as usize..s.match_end as usize]).unwrap();
        assert_eq!(marked, "café");

        // An astral character before the match counts as two units.
        let s = snippet("😀 needle", "needle");
        assert_eq!((s.match_start, s.match_end), (3, 9));

        // A decomposed accent stays with its letter.
        let s = snippet("cafe\u{301}!", "cafe");
        let units: Vec<u16> = s.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[s.match_start as usize..s.match_end as usize]).unwrap(),
            "cafe\u{301}"
        );
    }

    #[test]
    fn a_long_text_is_cut_around_the_match() {
        let text = format!("{} needle {}", "a".repeat(500), "b".repeat(500));
        let s = snippet(&text, "needle");
        assert!(s.text.starts_with('\u{2026}') && s.text.ends_with('\u{2026}'));
        assert!(s.text.chars().count() <= super::SNIPPET_LEN + 2);
        let units: Vec<u16> = s.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[s.match_start as usize..s.match_end as usize]).unwrap(),
            "needle"
        );
    }

    #[test]
    fn a_cursor_round_trips() {
        for c in [
            Cursor {
                index: 0,
                step: Step::Message,
            },
            Cursor {
                index: 41,
                step: Step::Replies(None),
            },
            Cursor {
                index: 7,
                step: Step::Replies(Some("ab12_99".to_owned())),
            },
        ] {
            assert_eq!(Cursor::decode(&c.encode()), Some(c));
        }
        assert_eq!(Cursor::decode("not-a-number"), None);
        assert_eq!(Cursor::decode(""), None);
    }
}
