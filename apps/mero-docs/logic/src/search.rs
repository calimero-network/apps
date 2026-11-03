//! `searchDocs` without the node's full-text index, which core `1.0.0-rc.7`
//! does not give components: every word of the query must start a word of the
//! title or the body (v1's `Query::prefix`), case-insensitively. A word found
//! in the title scores 2 (v1 weighted the title double), in the body 1; best
//! match first, then by title.

/// The words of `text`, lowercased: runs of letters and digits.
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// The query's words, lowercased.
pub fn terms(query: &str) -> Vec<String> {
    words(query)
}

/// How well a document matches `terms`; `None` when a term matches nothing.
pub fn score(terms: &[String], title: &str, body: &str) -> Option<f32> {
    let (title_words, body_words) = (words(title), words(body));
    let mut total = 0.0;
    for term in terms {
        if title_words.iter().any(|w| w.starts_with(term.as_str())) {
            total += 2.0;
        } else if body_words.iter().any(|w| w.starts_with(term.as_str())) {
            total += 1.0;
        } else {
            return None;
        }
    }
    Some(total)
}

/// Characters of context kept on each side of the first match.
const CONTEXT: usize = 40;

/// A fragment of `text` around the first word a term starts, the matching
/// words wrapped in `<b>`; empty when no word matches.
pub fn snippet(terms: &[String], text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    // Word boundaries as (start, end) char positions.
    let mut spans = Vec::new();
    let mut start = None;
    for (i, c) in chars.iter().enumerate() {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                spans.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        spans.push((s, chars.len()));
    }
    let hit = |(s, e): (usize, usize)| {
        let word: String = chars[s..e].iter().collect::<String>().to_lowercase();
        terms.iter().any(|t| word.starts_with(t.as_str()))
    };
    let Some(first) = spans.iter().copied().find(|w| hit(*w)) else {
        return String::new();
    };
    let from = first.0.saturating_sub(CONTEXT);
    let to = (first.1 + CONTEXT).min(chars.len());
    let mut out = String::new();
    if from > 0 {
        out.push('…');
    }
    let mut at = from;
    for (s, e) in spans.into_iter().filter(|(s, e)| *s >= from && *e <= to) {
        if !hit((s, e)) {
            continue;
        }
        out.extend(&chars[at..s]);
        out.push_str("<b>");
        out.extend(&chars[s..e]);
        out.push_str("</b>");
        at = e;
    }
    out.extend(&chars[at..to]);
    if to < chars.len() {
        out.push('…');
    }
    out
}
