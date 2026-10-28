import Foundation

/// A message body, as the web app writes it: the HTML its rich-text editor
/// produces (`<p>`, `<strong>`, `<em>`, `<u>`, `<s>`, `<code>`, `<pre>`,
/// `<ul>`/`<ol>`, `<blockquote>`, `<a>`), passed through `markdownParser.ts`,
/// which wraps `@name` / `@everyone` / `@here` in `<span class="mention…">`.
///
/// The phone reads that HTML into blocks it can draw natively, and writes the
/// same HTML back from what the composer holds, so a message looks the same
/// whichever client sent it. A body with no tags at all (an older client's
/// plain text) reads as plain paragraphs.
struct RichText: Equatable, Sendable {
    struct Style: OptionSet, Hashable, Sendable {
        let rawValue: Int
        static let bold = Style(rawValue: 1 << 0)
        static let italic = Style(rawValue: 1 << 1)
        static let underline = Style(rawValue: 1 << 2)
        static let strike = Style(rawValue: 1 << 3)
        static let code = Style(rawValue: 1 << 4)
    }

    enum Mention: Equatable, Sendable {
        /// `@name` of a member.
        case user
        /// `@everyone` / `@here`.
        case broadcast
    }

    /// A run of text with one style.
    struct Run: Equatable, Sendable {
        var text: String
        var style: Style = []
        var link: String?
        var mention: Mention?
    }

    enum Block: Equatable, Sendable {
        case paragraph([Run])
        case list(ordered: Bool, items: [[Run]])
        case code(String)
        case quote([Run])
    }

    var blocks: [Block]

    /// The text a person reads, without markup (search snippets, previews, copy).
    var plainText: String {
        blocks.map { block in
            switch block {
            case .paragraph(let runs), .quote(let runs): return runs.map(\.text).joined()
            case .code(let text): return text
            case .list(let ordered, let items):
                return items.enumerated().map { i, runs in
                    (ordered ? "\(i + 1). " : "• ") + runs.map(\.text).joined()
                }.joined(separator: "\n")
            }
        }.joined(separator: "\n")
    }

    var isEmpty: Bool { plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

// MARK: - Reading HTML

extension RichText {
    /// Parse a message body. Tags outside the editor's set are dropped and their text kept.
    static func parse(html: String) -> RichText {
        guard html.contains("<") else {
            let paragraphs = html.components(separatedBy: "\n").map { [Run(text: decodeEntities($0))] }
            return RichText(blocks: paragraphs.map { .paragraph($0) })
        }
        var parser = HTMLReader()
        parser.read(html)
        return RichText(blocks: parser.finish())
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var out = ""
        var rest = Substring(text)
        while let amp = rest.firstIndex(of: "&") {
            out += rest[..<amp]
            let tail = rest[amp...]
            guard let semi = tail.firstIndex(of: ";"), tail.distance(from: amp, to: semi) <= 10 else {
                out += "&"
                rest = rest[rest.index(after: amp)...]
                continue
            }
            let name = String(tail[tail.index(after: amp)..<semi])
            if let decoded = entity(name) {
                out += decoded
                rest = rest[rest.index(after: semi)...]
            } else {
                out += "&"
                rest = rest[rest.index(after: amp)...]
            }
        }
        return out + rest
    }

    private static func entity(_ name: String) -> String? {
        switch name {
        case "amp": return "&"
        case "lt": return "<"
        case "gt": return ">"
        case "quot": return "\""
        case "apos", "#39", "#x27": return "'"
        case "nbsp": return "\u{00A0}"
        default:
            if name.hasPrefix("#x") || name.hasPrefix("#X"), let v = UInt32(name.dropFirst(2), radix: 16) {
                return Unicode.Scalar(v).map { String($0) }
            }
            if name.hasPrefix("#"), let v = UInt32(name.dropFirst()) {
                return Unicode.Scalar(v).map { String($0) }
            }
            return nil
        }
    }
}

/// A small, forgiving reader for the editor's HTML. It never fails: an
/// unclosed tag ends with the message, a stray closing tag is ignored.
private struct HTMLReader {
    private var blocks: [RichText.Block] = []
    private var runs: [RichText.Run] = []
    private var styles: [(tag: String, style: RichText.Style)] = []
    private var links: [String?] = []
    private var mention: RichText.Mention?
    private var mentionDepth = 0
    private var listStack: [(ordered: Bool, items: [[RichText.Run]])] = []
    private var inPre = false
    private var preText = ""
    private var inQuote = false

    private var style: RichText.Style { styles.reduce([]) { $0.union($1.style) } }

    mutating func read(_ html: String) {
        var i = html.startIndex
        while i < html.endIndex {
            if html[i] == "<", let close = html[i...].firstIndex(of: ">") {
                tag(String(html[html.index(after: i)..<close]))
                i = html.index(after: close)
            } else {
                let next = html[i...].firstIndex(of: "<") ?? html.endIndex
                text(RichText.decodeEntities(String(html[i..<next])))
                i = next
            }
        }
    }

    mutating func finish() -> [RichText.Block] {
        flushParagraph()
        while !listStack.isEmpty { closeList() }
        return blocks
    }

    private mutating func text(_ raw: String) {
        if inPre {
            preText += raw
            return
        }
        // Whitespace between block tags is formatting, not content.
        if runs.isEmpty, raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        let collapsed = raw.replacingOccurrences(of: "\n", with: " ")
        var run = RichText.Run(text: collapsed, style: style, link: links.last ?? nil, mention: mention)
        if let last = runs.last, last.style == run.style, last.link == run.link, last.mention == run.mention {
            run.text = last.text + run.text
            runs.removeLast()
        }
        runs.append(run)
    }

    private mutating func tag(_ raw: String) {
        let closing = raw.hasPrefix("/")
        let body = closing ? String(raw.dropFirst()) : raw
        let name = body.prefix { $0.isLetter || $0.isNumber }.lowercased()
        let attrs = String(body.dropFirst(name.count))
        switch name {
        case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6":
            if listStack.isEmpty { flushParagraph() }
        case "br":
            if inPre { preText += "\n" } else { text("\n") }
        case "strong", "b": toggle(name, .bold, closing)
        case "em", "i": toggle(name, .italic, closing)
        case "u": toggle(name, .underline, closing)
        case "s", "del", "strike": toggle(name, .strike, closing)
        case "code" where !inPre: toggle(name, .code, closing)
        case "pre":
            if closing {
                inPre = false
                blocks.append(.code(preText.trimmingCharacters(in: .newlines)))
                preText = ""
            } else {
                flushParagraph()
                inPre = true
            }
        case "a":
            if closing { _ = links.popLast() } else { links.append(Self.attribute("href", in: attrs)) }
        case "span":
            if closing {
                if mentionDepth > 0 {
                    mentionDepth -= 1
                    if mentionDepth == 0 { mention = nil }
                }
            } else if let cls = Self.attribute("class", in: attrs), cls.contains("mention") {
                mention = cls.contains("mention-everyone") || cls.contains("mention-here") ? .broadcast : .user
                mentionDepth = 1
            } else if mentionDepth > 0 {
                mentionDepth += 1
            }
        case "ul", "ol":
            if closing {
                closeList()
            } else {
                flushParagraph()
                listStack.append((ordered: name == "ol", items: []))
            }
        case "li":
            if closing {
                if !listStack.isEmpty {
                    listStack[listStack.count - 1].items.append(trimmed(runs))
                    runs = []
                }
            }
        case "blockquote":
            flushParagraph()
            inQuote = !closing
        default:
            break
        }
    }

    private mutating func toggle(_ tag: String, _ style: RichText.Style, _ closing: Bool) {
        if closing {
            if let i = styles.lastIndex(where: { $0.tag == tag }) { styles.remove(at: i) }
        } else {
            styles.append((tag: tag, style: style))
        }
    }

    private mutating func closeList() {
        guard let list = listStack.popLast() else { return }
        var items = list.items
        if !runs.isEmpty {
            items.append(trimmed(runs))
            runs = []
        }
        blocks.append(.list(ordered: list.ordered, items: items))
    }

    private mutating func flushParagraph() {
        let content = trimmed(runs)
        runs = []
        guard !content.isEmpty else { return }
        blocks.append(inQuote ? .quote(content) : .paragraph(content))
    }

    private func trimmed(_ runs: [RichText.Run]) -> [RichText.Run] {
        var out = runs
        while let first = out.first, first.text.trimmingCharacters(in: .whitespaces).isEmpty, first.text != "\n" {
            out.removeFirst()
        }
        if !out.isEmpty {
            out[0].text = String(out[0].text.drop { $0 == " " })
            out[out.count - 1].text = String(out[out.count - 1].text.reversed().drop { $0 == " " }.reversed())
        }
        return out.filter { !$0.text.isEmpty }
    }

    static func attribute(_ name: String, in attrs: String) -> String? {
        for quote in ["\"", "'"] {
            let marker = "\(name)=\(quote)"
            guard let start = attrs.range(of: marker) else { continue }
            let rest = attrs[start.upperBound...]
            guard let end = rest.firstIndex(of: Character(quote)) else { continue }
            return RichText.decodeEntities(String(rest[..<end]))
        }
        return nil
    }
}

// MARK: - Writing HTML

/// What the composer holds, as plain text with the toolbar's marks
/// (`**bold**`, `*italic*`, `__underline__`, `` `code` ``, `- ` and `1. `
/// list lines, ``` fences), turned into the HTML the web editor would have
/// produced, mentions wrapped the way `markdownParser.ts` wraps them.
enum ChatComposerText {
    static func html(from text: String, members: [String] = []) -> String {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var out = ""
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i])
                    i += 1
                }
                i += 1
                out += "<pre><code>\(escape(code.joined(separator: "\n")))</code></pre>"
                continue
            }
            if let kind = listKind(line) {
                var items: [String] = []
                while i < lines.count, listKind(lines[i]) == kind {
                    items.append(listItemText(lines[i]))
                    i += 1
                }
                let tag = kind == .ordered ? "ol" : "ul"
                out += "<\(tag)>" + items.map { "<li><p>\(inline($0, members: members))</p></li>" }.joined() + "</\(tag)>"
                continue
            }
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                i += 1
                continue
            }
            out += "<p>\(inline(line, members: members))</p>"
            i += 1
        }
        return out
    }

    /// The composer text for an existing message (to edit it): the reverse of ``html(from:members:)``.
    static func text(from rich: RichText) -> String {
        rich.blocks.map { block -> String in
            switch block {
            case .paragraph(let runs), .quote(let runs): return marked(runs)
            case .code(let code): return "```\n\(code)\n```"
            case .list(let ordered, let items):
                return items.enumerated().map { i, runs in (ordered ? "\(i + 1). " : "- ") + marked(runs) }
                    .joined(separator: "\n")
            }
        }.joined(separator: "\n")
    }

    private enum ListKind { case bullet, ordered }

    private static func listKind(_ line: String) -> ListKind? {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("- ") || t.hasPrefix("• ") { return .bullet }
        if let dot = t.firstIndex(of: "."), t[..<dot].allSatisfy(\.isNumber), !t[..<dot].isEmpty,
            t[t.index(after: dot)...].hasPrefix(" ")
        {
            return .ordered
        }
        return nil
    }

    private static func listItemText(_ line: String) -> String {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("- ") || t.hasPrefix("• ") { return String(t.dropFirst(2)) }
        guard let dot = t.firstIndex(of: ".") else { return t }
        return String(t[t.index(after: dot)...].dropFirst())
    }

    private static let marks: [(open: String, tag: String)] = [
        ("**", "strong"), ("__", "u"), ("`", "code"), ("*", "em"), ("~~", "s"),
    ]

    /// Inline marks, then mentions, all over escaped text.
    static func inline(_ raw: String, members: [String]) -> String {
        var html = ""
        var rest = Substring(raw)
        outer: while !rest.isEmpty {
            for mark in marks where rest.hasPrefix(mark.open) {
                let after = rest.dropFirst(mark.open.count)
                if let end = after.range(of: mark.open), !after[..<end.lowerBound].isEmpty {
                    let inner = String(after[..<end.lowerBound])
                    let content = mark.tag == "code" ? escape(inner) : inline(inner, members: members)
                    html += "<\(mark.tag)>\(content)</\(mark.tag)>"
                    rest = after[end.upperBound...]
                    continue outer
                }
            }
            let next = rest.dropFirst().firstIndex { c in marks.contains { $0.open.first == c } } ?? rest.endIndex
            html += mentions(in: escape(String(rest[..<next])), members: members)
            rest = rest[next...]
        }
        return html
    }

    /// `markdownParser.ts`: `@everyone` / `@here`, then each member's `@name`.
    static func mentions(in escaped: String, members: [String]) -> String {
        var out = escaped
            .replacingOccurrences(of: "@everyone", with: "<span class='mention-everyone'>@everyone</span>")
            .replacingOccurrences(of: "@here", with: "<span class='mention-here'>@here</span>")
        for member in members.sorted(by: { $0.count > $1.count }) where !member.isEmpty {
            let escapedName = escape(member)
            let cls = member.replacingOccurrences(of: " ", with: "").lowercased()
            out = out.replacingOccurrences(
                of: "@\(escapedName)", with: "<span class=\"mention mention-user-\(cls)\">@\(escapedName)</span>",
                options: .caseInsensitive)
        }
        return out
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func marked(_ runs: [RichText.Run]) -> String {
        runs.map { run in
            var t = run.text
            if run.style.contains(.code) { return "`\(t)`" }
            if run.style.contains(.italic) { t = "*\(t)*" }
            if run.style.contains(.underline) { t = "__\(t)__" }
            if run.style.contains(.strike) { t = "~~\(t)~~" }
            if run.style.contains(.bold) { t = "**\(t)**" }
            return t
        }.joined()
    }
}
