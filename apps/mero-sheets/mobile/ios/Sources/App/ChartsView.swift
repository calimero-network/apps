import Charts
import SheetsCore
import SwiftUI

/// The open sheet's charts, drawn with Swift Charts from the grid's values.
struct ChartsSheet: View {
    @ObservedObject var model: SpreadsheetModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                let charts = model.sheetCharts
                if charts.isEmpty {
                    EmptyState(
                        icon: "chart.bar", title: "No charts on this sheet",
                        message: "Charts are made in the web app from a range of cells. They show here as the numbers change.")
                } else {
                    ScrollView {
                        VStack(spacing: 14) {
                            ForEach(charts) { ChartCard(chart: $0) }
                        }
                        .padding(Theme.gutter)
                    }
                }
            }
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(model.activeSheet.map { "Charts · \($0.name)" } ?? "Charts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
    }
}

/// One chart: title, legend, the plot (bars or lines from zero), and its numbers on demand.
struct ChartCard: View {
    let chart: PlacedChart
    @State private var showData = false

    private struct Point: Identifiable {
        let id: String
        let label: String
        let index: Int
        let series: String
        let value: Double
    }

    private var points: [Point] {
        chart.model.series.flatMap { s in
            s.values.enumerated().compactMap { i, v in
                v.map { Point(id: "\(s.name)-\(i)", label: chart.model.labels[i], index: i, series: s.name, value: $0) }
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(chart.title).font(Theme.heading(16)).foregroundStyle(Theme.ink)
                    Text("\(chart.kind == "line" ? "Line" : "Bar") chart · \(chart.range)")
                        .font(.system(size: 12)).foregroundStyle(Theme.text3)
                }
                Spacer()
                Button(showData ? "Chart" : "Show data") { showData.toggle() }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
            }
            if chart.model.series.count >= 2 && !showData { legend }
            if showData { table } else { plot.frame(height: 220) }
            if chart.model.dropped > 0 {
                Text("\(chart.model.dropped) more column\(chart.model.dropped == 1 ? "" : "s") not shown (a chart shows eight series).")
                    .font(.system(size: 12)).foregroundStyle(Theme.text3)
            }
        }
        .card()
    }

    private var names: [String] { chart.model.series.map(\.name) }
    private var colors: [Color] { names.indices.map { Theme.series[$0 % Theme.series.count] } }

    @ViewBuilder private var plot: some View {
        let ticks = ChartModel.niceTicks(min: chart.model.allValues.min() ?? 0, max: chart.model.allValues.max() ?? 1)
        Chart(points) { p in
            if chart.kind == "line" {
                LineMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                PointMark(x: .value("Label", p.label), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(24)
            } else {
                BarMark(x: .value("Label", p.label), y: .value("Value", p.value), width: .ratio(0.8))
                    .foregroundStyle(by: .value("Series", p.series))
                    .position(by: .value("Series", p.series))
                    .cornerRadius(4)
            }
        }
        .chartForegroundStyleScale(domain: names, range: colors)
        .chartLegend(.hidden)
        .chartXScale(domain: chart.model.labels)
        .chartYScale(domain: (ticks.first ?? 0)...(ticks.last ?? 1))
        .chartYAxis {
            AxisMarks(position: .leading, values: ticks) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(Theme.line)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(ChartModel.formatTick(v)).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.text3)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let s = value.as(String.self) {
                        Text(s.count > 8 ? "\(s.prefix(7))…" : s).font(.system(size: 10)).foregroundStyle(Theme.text3)
                    }
                }
            }
        }
        .accessibilityLabel("\(chart.kind == "line" ? "Line" : "Bar") chart: \(chart.title)")
    }

    private var legend: some View {
        FlowRow(items: Array(names.enumerated()), id: \.offset) { item in
            HStack(spacing: 5) {
                RoundedRectangle(cornerRadius: 3).fill(colors[item.offset]).frame(width: 10, height: 10)
                Text(item.element).font(.system(size: 12)).foregroundStyle(Theme.text2)
            }
        }
    }

    private var table: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 6) {
                GridRow {
                    Text("").gridColumnAlignment(.leading)
                    ForEach(names.indices, id: \.self) { i in
                        Text(names[i]).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text3)
                    }
                }
                Divider()
                ForEach(chart.model.labels.indices, id: \.self) { r in
                    GridRow {
                        Text(chart.model.labels[r]).font(.system(size: 12)).foregroundStyle(Theme.text3)
                        ForEach(chart.model.series.indices, id: \.self) { s in
                            Text(chart.model.series[s].values[r].map(ChartModel.formatTick) ?? "—")
                                .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.ink)
                        }
                    }
                }
            }
        }
    }
}

/// Items laid out left to right, wrapping onto new lines.
struct FlowRow<Item, ID: Hashable, Content: View>: View {
    let items: [Item]
    let id: KeyPath<Item, ID>
    @ViewBuilder let content: (Item) -> Content

    var body: some View {
        FlowLayout(spacing: 12, lineSpacing: 4) {
            ForEach(items, id: id) { content($0) }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > width {
                x = 0
                y += line + lineSpacing
                line = 0
            }
            x += s.width + spacing
            line = max(line, s.height)
        }
        return CGSize(width: width == .infinity ? x : width, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX {
                x = bounds.minX
                y += line + lineSpacing
                line = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}
