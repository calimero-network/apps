import Foundation

/// What a chart plots, read from its range (`app/src/spreadsheet/chart.ts`):
/// the first column labels the points, each other column is a series (named by
/// the first row when that row is text), up to eight series. A one-column
/// range is a single series labelled by row number.
public struct ChartSeries: Equatable, Sendable {
    public let name: String
    /// One per label; nil where the cell is not a number.
    public let values: [Double?]
}

public struct ChartModel: Equatable, Sendable {
    public static let maxSeries = 8

    public let labels: [String]
    public let series: [ChartSeries]
    /// Columns past the eighth, left out.
    public let dropped: Int

    /// Rows `top...bottom`, columns `left...right` (positions), read through `valueAt`.
    public init(top: Int, left: Int, bottom: Int, right: Int, valueAt: (Int, Int) -> String) {
        let single = left == right
        let seriesCols = single ? [left] : Array((left + 1)...max(left + 1, right))
        let header = bottom > top && seriesCols.allSatisfy { c in
            let v = valueAt(top, c).trimmingCharacters(in: .whitespaces)
            return !v.isEmpty && CellFormat.number(v) == nil
        }
        let first = top + (header ? 1 : 0)
        let rows = first <= bottom ? Array(first...bottom) : []
        let kept = Array(seriesCols.prefix(Self.maxSeries))
        labels = rows.map { r in
            if single { return String(r + 1) }
            let l = valueAt(r, left).trimmingCharacters(in: .whitespaces)
            return l.isEmpty ? String(r + 1) : l
        }
        series = kept.map { c in
            ChartSeries(
                name: header ? valueAt(top, c).trimmingCharacters(in: .whitespaces) : A1.column(c),
                values: rows.map { CellFormat.number(valueAt($0, c)) })
        }
        dropped = seriesCols.count - kept.count
    }

    public init(labels: [String], series: [ChartSeries], dropped: Int = 0) {
        self.labels = labels
        self.series = series
        self.dropped = dropped
    }

    /// Round tick values covering `[min, max]`, always including 0.
    public static func niceTicks(min: Double, max: Double, count: Int = 5) -> [Double] {
        let lo = Swift.min(0, min)
        let hi = Swift.max(0, max)
        if lo == hi { return [0, 1] }
        let raw = (hi - lo) / Double(count)
        let mag = pow(10, floor(log10(raw)))
        let step = [1, 2, 2.5, 5, 10].map { $0 * mag }.first { $0 >= raw } ?? 10 * mag
        let start = floor(lo / step) * step
        var ticks: [Double] = []
        var t = start
        while t <= hi + step * 1e-9 {
            ticks.append((t * 1e12).rounded() / 1e12)
            t += step
        }
        if let last = ticks.last, last < hi { ticks.append(((last + step) * 1e12).rounded() / 1e12) }
        return ticks
    }

    /// A tick or value as shown: thousands separated, compact past a million.
    public static func formatTick(_ n: Double) -> String {
        let a = abs(n)
        func short(_ v: Double) -> String {
            let r = (v * 10).rounded() / 10
            return r == r.rounded() ? String(Int(r)) : String(r)
        }
        if a >= 1e9 { return "\(short(n / 1e9))B" }
        if a >= 1e6 { return "\(short(n / 1e6))M" }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    public var allValues: [Double] { series.flatMap { $0.values.compactMap { $0 } } }
}
