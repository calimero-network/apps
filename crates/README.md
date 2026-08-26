# `crates/`

Rust shared between app contracts. Empty on purpose, and wired into the
workspace anyway — `members` already globs `crates/*`, so the first shared crate
is a directory and nothing else.

A seam that already builds is a seam people use. A seam that has to be invented
later is a seam nobody uses.

Nothing belongs here until at least two apps need it. Extract from a second
consumer, not from a first guess.
