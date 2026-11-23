import Foundation

/// Row and column order: which id sits at which position. The twin of
/// `logic/crates/recalc/src/layout.rs` (`Axis::build`).
///
/// A cell is stored under row and column ids, never positions. An untouched axis
/// has the implicit layout (id `k` at position `k`); an explicit entry adds a row
/// or column (a new id at a generated position, compared as a string) or deletes
/// one (a tombstone on its id).
public struct AxisOrder: Equatable, Sendable {
    /// The id at each position.
    public let ids: [String]
    private let index: [String: Int]

    /// Rows a sheet has (`MAX_ROWS`) and columns (`MAX_COLS`, `A`..`ZZ`).
    public static let maxRows = 1000
    public static let maxCols = 702

    public init(entries: [AxisEntryView], length: Int) {
        guard !entries.isEmpty else {
            ids = (0..<length).map(String.init)
            index = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
            return
        }
        var deletedImplicit: [Int: Bool] = [:]
        var added: [(pos: String, id: String)] = []
        for e in entries {
            if let k = Self.implicitIndex(e.id) {
                deletedImplicit[k] = e.deleted
            } else if !e.deleted {
                added.append((e.pos, e.id))
            }
        }
        added.sort { ($0.pos, $0.id) < ($1.pos, $1.id) }
        var out: [String] = []
        out.reserveCapacity(length)
        var nextImplicit = 0
        var nextAdded = 0
        while out.count < length {
            let implicit = Self.implicitPos(nextImplicit)
            // (pos, id) < (implicit, "") ⇔ pos < implicit, as an id is never empty.
            if nextAdded < added.count, added[nextAdded].pos < implicit {
                out.append(added[nextAdded].id)
                nextAdded += 1
            } else {
                if !(deletedImplicit[nextImplicit] ?? false) { out.append(String(nextImplicit)) }
                nextImplicit += 1
            }
        }
        ids = out
        var map: [String: Int] = [:]
        for (i, id) in out.enumerated() { map[id] = i }
        index = map
    }

    public var count: Int { ids.count }

    /// The position of an id, or nil when it is deleted or past the end.
    public func position(of id: String) -> Int? { index[id] }

    public func id(at position: Int) -> String? { position >= 0 && position < ids.count ? ids[position] : nil }

    /// `5` and the index zero-padded to nine digits.
    static func implicitPos(_ k: Int) -> String {
        let digits = String(k)
        return "5" + String(repeating: "0", count: max(0, 9 - digits.count)) + digits
    }

    /// The implicit index an id names (`"12"`, never `"012"`).
    public static func implicitIndex(_ id: String) -> Int? {
        guard !id.isEmpty, id.allSatisfy({ $0.isASCII && $0.isNumber }), !(id.count > 1 && id.hasPrefix("0")) else { return nil }
        return Int(id)
    }
}

/// A sheet's rows and columns in order.
public struct SheetOrder: Equatable, Sendable {
    public let rows: AxisOrder
    public let cols: AxisOrder

    public init(layout: SheetLayout?) {
        rows = AxisOrder(entries: layout?.rows ?? [], length: AxisOrder.maxRows)
        cols = AxisOrder(entries: layout?.cols ?? [], length: AxisOrder.maxCols)
    }
}

/// A1 addressing (`app/src/spreadsheet/refs.ts`).
public enum A1 {
    /// 0-based column → letters (`0→A`, `25→Z`, `26→AA`).
    public static func column(_ col: Int) -> String {
        var n = col
        var label = ""
        repeat {
            label = String(UnicodeScalar(UInt8(65 + n % 26))) + label
            n = n / 26 - 1
        } while n >= 0
        return label
    }

    /// `B3` for 0-based row 2, column 1.
    public static func cell(row: Int, col: Int) -> String { "\(column(col))\(row + 1)" }

    /// Letters → 0-based column (`A→0`, `AA→26`); nil when not letters.
    public static func columnIndex(_ letters: String) -> Int? {
        guard !letters.isEmpty, letters.count <= 3 else { return nil }
        var n = 0
        for ch in letters.uppercased() {
            guard let v = ch.asciiValue, v >= 65, v <= 90 else { return nil }
            n = n * 26 + Int(v - 64)
        }
        return n - 1
    }

    /// `Data!` or `'Sheet 1'!`: simple names bare, others quoted with `'` doubled.
    public static func sheetPrefix(_ name: String) -> String {
        let simple = name.first.map { $0.isASCII && $0.isLetter } == true
            && name.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return simple ? "\(name)!" : "'\(name.replacingOccurrences(of: "'", with: "''"))'!"
    }
}
