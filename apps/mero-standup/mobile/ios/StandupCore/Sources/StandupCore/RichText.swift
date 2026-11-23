import Foundation

/// The little formatting a standup needs (the web's `lib/rich.ts`): bullet
/// lines, links and `code`. Parsed into data; rendering never interprets
/// markup, since an update is text a teammate wrote.
public enum RichText {
    public enum Inline: Equatable, Sendable {
        case text(String)
        case code(String)
        case link(String)
    }

    public enum Block: Equatable, Sendable {
        case paragraph([Inline])
        case list([[Inline]])
    }

    /// Consecutive bullet lines become one list; everything else a paragraph.
    public static func parse(_ text: String) -> [Block] {
        var blocks: [Block] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            if let body = bulletBody(line) {
                let item = inlines(body)
                if case .list(var items)? = blocks.last {
                    items.append(item)
                    blocks[blocks.count - 1] = .list(items)
                } else {
                    blocks.append(.list([item]))
                }
            } else {
                blocks.append(.paragraph(inlines(line)))
            }
        }
        return blocks
    }

    /// `- x`, `* x`, `• x`, `1. x`, `1) x` -> `x`; nil for any other line.
    static func bulletBody(_ line: String) -> String? {
        let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
        if let first = trimmed.first, "-*•".contains(first) {
            let rest = trimmed.dropFirst()
            guard let space = rest.first, space.isWhitespace else { return nil }
            return String(rest.drop(while: { $0.isWhitespace }))
        }
        let digits = trimmed.prefix(while: { $0.isNumber })
        guard !digits.isEmpty else { return nil }
        let rest = trimmed.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")" else { return nil }
        let after = rest.dropFirst()
        guard let space = after.first, space.isWhitespace else { return nil }
        return String(after.drop(while: { $0.isWhitespace }))
    }

    /// Text, `code` spans and http(s) links.
    public static func inlines(_ text: String) -> [Inline] {
        var out: [Inline] = []
        var plain = ""
        var i = text.startIndex
        func flush() {
            if !plain.isEmpty { out.append(.text(plain)) }
            plain = ""
        }
        while i < text.endIndex {
            let c = text[i]
            if c == "`", let close = text[text.index(after: i)...].firstIndex(where: { $0 == "`" || $0 == "\n" }),
                text[close] == "`", close > text.index(after: i)
            {
                flush()
                out.append(.code(String(text[text.index(after: i)..<close])))
                i = text.index(after: close)
                continue
            }
            if c == "h", text[i...].hasPrefix("http://") || text[i...].hasPrefix("https://") {
                var end = text[i...].firstIndex(where: { $0.isWhitespace || "<>()".contains($0) }) ?? text.endIndex
                // Trailing punctuation belongs to the sentence, not the link.
                while end > i, ".,;:!?'\"".contains(text[text.index(before: end)]) { end = text.index(before: end) }
                let candidate = String(text[i..<end])
                let scheme = candidate.hasPrefix("https://") ? 8 : 7
                if candidate.count > scheme {
                    flush()
                    out.append(.link(candidate))
                    i = end
                    continue
                }
            }
            plain.append(c)
            i = text.index(after: i)
        }
        flush()
        return out
    }
}
