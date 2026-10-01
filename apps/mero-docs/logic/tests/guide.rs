//! The bundle's agent guide must satisfy the registry's format rules, or a publish is rejected.

const GUIDE: &str = include_str!("../GUIDE.md");
const MAX_GUIDE_BYTES: usize = 16384;
const SECTIONS: [&str; 5] = [
    "Overview",
    "Context model",
    "Getting started",
    "Procedures",
    "Rules and limits",
];

/// Lines outside fenced code blocks.
fn prose_lines(guide: &str) -> Vec<&str> {
    let mut fenced = false;
    let mut out = Vec::new();
    for line in guide.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
        } else if !fenced {
            out.push(line.trim_end());
        }
    }
    out
}

fn has_procedure(guide: &str) -> bool {
    prose_lines(guide)
        .into_iter()
        .skip_while(|l| *l != "## Procedures")
        .skip(1)
        .take_while(|l| !l.starts_with("## "))
        .any(|l| l.starts_with("### "))
}

#[test]
fn the_guide_has_the_required_sections_and_fits_the_size_limit() {
    let lines = prose_lines(GUIDE);
    for section in SECTIONS {
        assert!(
            lines.contains(&format!("## {section}").as_str()),
            "missing section '## {section}'"
        );
    }
    assert!(
        has_procedure(GUIDE),
        "'## Procedures' has no '###' procedure"
    );
    assert!(
        GUIDE.len() <= MAX_GUIDE_BYTES,
        "{} bytes exceeds the {MAX_GUIDE_BYTES} byte limit",
        GUIDE.len()
    );
    assert!(!GUIDE.contains('\u{2014}'), "the guide uses an em dash");
}

#[test]
fn a_procedure_heading_outside_procedures_does_not_count() {
    let guide = "## Procedures\n\n## Rules and limits\n\n### Not a procedure\n";
    assert!(!has_procedure(guide));
}
