import Foundation

/// A stored formula in the form people read it.
///
/// The contract stores formulas with rows and columns by id (`{r=k3;c=1}`, or
/// `B12` for implicit ids) and other sheets by id (`[sheet-id]!A1`). The web app
/// shows positions and sheet names; this is the twin of the engine's
/// `to_display` (`logic/crates/recalc/src/formula.rs`) plus the web's
/// `idsToNames` (`app/src/spreadsheet/sheetref.ts`). It only rewrites
/// reference spans: spacing, functions and strings stay exactly as written.
public enum FormulaDisplay {
    public static func display(
        _ formula: String, home: String, orders: (String) -> SheetOrder, sheetName: (String) -> String?
    ) -> String {
        guard formula.hasPrefix("=") else { return formula }
        let body = Array(formula.dropFirst())
        guard let toks = lex(body) else { return formula }
        var edits: [(start: Int, end: Int, text: String)] = []
        var i = 0
        while i < toks.count {
            var sheet: String?
            if case .sheet(let id) = toks[i].kind {
                sheet = id
                if let name = sheetName(id) {
                    edits.append((toks[i].start, toks[i].end, A1.sheetPrefix(name)))
                }
            }
            let first = i + (sheet == nil ? 0 : 1)
            guard first < toks.count else { break }
            let a = toks[first]
            let colon = first + 1 < toks.count && toks[first + 1].kind == .colon
            let b = colon && first + 2 < toks.count ? toks[first + 2] : nil
            let isCall = first + 1 < toks.count && toks[first + 1].kind == .lparen
            let ends: [Token]?
            switch (anchor(a), b.flatMap(anchor)) {
            case (.cell?, .cell?), (.col?, .col?), (.row?, .row?):
                ends = [a, b!]
            case (.cell?, _) where !(isCall || (colon && b != nil)):
                ends = [a]
            default:
                ends = nil
            }
            guard let ends else {
                i += 1
                continue
            }
            let order = orders(sheet ?? home)
            let parts = ends.map { rewrite($0, order: order) }
            let text: String
            if parts.contains(where: { $0 == nil }) {
                text = "#REF!"
            } else {
                text = parts.compactMap { $0 }.joined(separator: ":")
            }
            edits.append((ends[0].start, ends[ends.count - 1].end, text))
            i = first + (ends.count == 2 ? 3 : 1)
        }
        var out = "="
        var copied = 0
        for edit in edits.sorted(by: { $0.start < $1.start }) where edit.start >= copied {
            out += String(body[copied..<edit.start])
            out += edit.text
            copied = edit.end
        }
        out += String(body[copied...])
        return out
    }

    // MARK: Tokens

    enum Kind: Equatable {
        case sheet(String)
        case idRef(row: String?, col: String?)
        case word(String)
        case number(String)
        case colon, lparen, other
    }

    struct Token {
        let kind: Kind
        let start: Int
        let end: Int
        let raw: String
    }

    enum Anchor {
        case cell(row: String, col: String)
        case col(String)
        case row(String)
    }

    static func lex(_ c: [Character]) -> [Token]? {
        var out: [Token] = []
        var i = 0
        func isDigit(_ k: Int) -> Bool { k < c.count && c[k].isASCII && c[k].isNumber }
        func isWordChar(_ ch: Character) -> Bool { ch.isLetter || ch.isNumber || ch == "_" || ch == "." || ch == "$" }
        func number() -> Kind {
            let start = i
            while i < c.count, (c[i].isASCII && c[i].isNumber) || c[i] == "." { i += 1 }
            return .number(String(c[start..<i]))
        }
        func word() -> Kind {
            var w = ""
            while i < c.count, isWordChar(c[i]) {
                if c[i] != "$" { w.append(c[i]) }
                i += 1
            }
            return .word(w)
        }
        while i < c.count {
            let ch = c[i]
            let start = i
            let kind: Kind
            if ch == "$", isDigit(i + 1) {
                i += 1
                kind = number()
            } else if ch == "$" {
                i += 1
                guard i < c.count, c[i].isLetter else { continue }
                kind = word()
            } else if ch.isWhitespace {
                i += 1
                continue
            } else if ch == "\"" {
                i += 1
                while true {
                    guard i < c.count else { return nil }
                    if c[i] == "\"", i + 1 < c.count, c[i + 1] == "\"" {
                        i += 2
                    } else if c[i] == "\"" {
                        i += 1
                        break
                    } else {
                        i += 1
                    }
                }
                kind = .other
            } else if ch == "[" {
                guard let close = c[(i + 1)...].firstIndex(of: "]"), close + 1 < c.count, c[close + 1] == "!" else { return nil }
                kind = .sheet(String(c[(i + 1)..<close]))
                i = close + 2
            } else if ch == "{" {
                guard let close = c[(i + 1)...].firstIndex(of: "}") else { return nil }
                let inner = String(c[(i + 1)..<close])
                i = close + 1
                var row: String?
                var col: String?
                for part in inner.split(separator: ";") {
                    let pair = part.trimmingCharacters(in: .whitespaces).drop { $0 == "$" }.split(separator: "=", maxSplits: 1)
                    guard pair.count == 2 else { return nil }
                    let id = pair[1].trimmingCharacters(in: .whitespaces)
                    guard !id.isEmpty, id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return nil }
                    switch pair[0].trimmingCharacters(in: .whitespaces) {
                    case "r" where row == nil: row = id
                    case "c" where col == nil: col = id
                    default: return nil
                    }
                }
                kind = .idRef(row: row, col: col)
            } else if ch == "#" {
                i += 1
                while i < c.count, c[i].isLetter || c[i].isNumber || "/!?".contains(c[i]) { i += 1 }
                kind = .other
            } else if (ch.isASCII && ch.isNumber) || ch == "." {
                kind = number()
            } else if ch.isLetter || ch == "_" {
                kind = word()
            } else {
                switch ch {
                case "(": kind = .lparen
                case ":": kind = .colon
                default: kind = .other
                }
                i += (ch == "<" || ch == ">") && i + 1 < c.count && (c[i + 1] == "=" || c[i + 1] == ">") ? 2 : 1
            }
            out.append(Token(kind: kind, start: start, end: i, raw: String(c[start..<i])))
        }
        return out
    }

    static func anchor(_ t: Token) -> Anchor? {
        switch t.kind {
        case .word(let w):
            if let (r, col) = cellWord(w) { return .cell(row: String(r), col: String(col)) }
            return A1.columnIndex(w).flatMap { $0 < AxisOrder.maxCols ? .col(String($0)) : nil }
        case .number(let n):
            guard let v = Int(n), v >= 1, !n.contains(".") else { return nil }
            return .row(String(v - 1))
        case .idRef(let row?, let col?): return .cell(row: row, col: col)
        case .idRef(nil, let col?): return .col(col)
        case .idRef(let row?, nil): return .row(row)
        default: return nil
        }
    }

    /// `B12` → (11, 1).
    static func cellWord(_ w: String) -> (Int, Int)? {
        guard let split = w.firstIndex(where: { $0.isASCII && $0.isNumber }) else { return nil }
        let letters = String(w[..<split])
        let digits = String(w[split...])
        guard let col = A1.columnIndex(letters), col < AxisOrder.maxCols,
            digits.allSatisfy({ $0.isASCII && $0.isNumber }), let row = Int(digits), row >= 1
        else { return nil }
        return (row - 1, col)
    }

    /// One reference end with positions, or nil when its row or column is gone.
    static func rewrite(_ t: Token, order: SheetOrder) -> String? {
        guard let anchor = anchor(t) else { return nil }
        let (colAbs, rowAbs) = anchors(t.raw)
        let dollar = { (abs: Bool) in abs ? "$" : "" }
        switch anchor {
        case .cell(let r, let c):
            guard let row = order.rows.position(of: r), let col = order.cols.position(of: c) else { return nil }
            return "\(dollar(colAbs))\(A1.column(col))\(dollar(rowAbs))\(row + 1)"
        case .col(let c):
            guard let col = order.cols.position(of: c) else { return nil }
            return "\(dollar(colAbs))\(A1.column(col))"
        case .row(let r):
            guard let row = order.rows.position(of: r) else { return nil }
            return "\(dollar(rowAbs))\(row + 1)"
        }
    }

    static func anchors(_ raw: String) -> (col: Bool, row: Bool) {
        if raw.hasPrefix("{") { return (raw.contains("$c="), raw.contains("$r=")) }
        let chars = Array(raw)
        var rowAbs = false
        for (i, ch) in chars.enumerated() where ch == "$" && i + 1 < chars.count && chars[i + 1].isNumber {
            rowAbs = true
        }
        return (raw.hasPrefix("$"), rowAbs)
    }
}
