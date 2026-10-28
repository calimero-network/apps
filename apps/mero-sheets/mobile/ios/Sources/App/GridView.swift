import SheetsCore
import SwiftUI
import UIKit

/// The spreadsheet grid: a native scroll view (momentum, bounce) with pinch to
/// zoom, frozen header row and column, the sheet's frozen panes, column widths
/// and row heights, and each cell's format and style. Only the visible cells
/// are drawn.
struct GridView: UIViewRepresentable {
    let grid: SheetGrid
    @Binding var selected: GridPos?
    var onDoubleTap: (GridPos) -> Void

    func makeUIView(context: Context) -> GridScrollView {
        let view = GridScrollView()
        view.onSelect = { pos in
            UISelectionFeedbackGenerator().selectionChanged()
            selected = pos
        }
        view.onDoubleTap = onDoubleTap
        view.configure(grid: grid, selected: selected)
        return view
    }

    func updateUIView(_ view: GridScrollView, context: Context) {
        view.onSelect = { pos in
            UISelectionFeedbackGenerator().selectionChanged()
            selected = pos
        }
        view.onDoubleTap = onDoubleTap
        view.configure(grid: grid, selected: selected)
    }
}

final class GridScrollView: UIScrollView {
    static let headerHeight = CGFloat(SheetGrid.headerHeight)
    static let rowHeaderWidth = CGFloat(SheetGrid.rowHeaderWidth)

    private let canvas = GridCanvas()
    private(set) var grid: SheetGrid?
    private(set) var selected: GridPos?
    private(set) var scale: CGFloat = 1
    var onSelect: ((GridPos) -> Void)?
    var onDoubleTap: ((GridPos) -> Void)?
    private var tappedSelection: GridPos?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        showsHorizontalScrollIndicator = true
        showsVerticalScrollIndicator = true
        isDirectionalLockEnabled = true
        alwaysBounceVertical = true
        alwaysBounceHorizontal = true
        canvas.owner = self
        canvas.isUserInteractionEnabled = false
        canvas.backgroundColor = .white
        canvas.contentMode = .redraw
        addSubview(canvas)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        addGestureRecognizer(tap)
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        double.numberOfTapsRequired = 2
        addGestureRecognizer(double)
        addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
        isAccessibilityElement = true
        accessibilityLabel = "Spreadsheet grid"
        accessibilityHint = "Tap a cell to see its value. Double-tap to edit it."
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func configure(grid: SheetGrid, selected: GridPos?) {
        let sheetChanged = self.grid?.sheetId != grid.sheetId
        let selectionChanged = self.selected != selected
        self.grid = grid
        self.selected = selected
        updateContentSize()
        if sheetChanged { contentOffset = .zero }
        if selectionChanged, let selected, selected != tappedSelection { reveal(selected) }
        tappedSelection = nil
        canvas.setNeedsDisplay()
    }

    private func updateContentSize() {
        guard let grid else { return }
        contentSize = CGSize(
            width: (Self.rowHeaderWidth + CGFloat(grid.totalWidth)) * scale,
            height: (Self.headerHeight + CGFloat(grid.totalHeight)) * scale)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        canvas.frame = bounds
        canvas.setNeedsDisplay()
    }

    // MARK: Geometry (unscaled points)

    /// The on-screen rect of a cell, in the canvas's unscaled space.
    func cellRect(_ pos: GridPos) -> CGRect? {
        guard let grid, pos.row < grid.rowCount, pos.col < grid.colCount else { return nil }
        let ox = contentOffset.x / scale
        let oy = contentOffset.y / scale
        let x0 = CGFloat(grid.colOffsets[pos.col])
        let y0 = CGFloat(grid.rowOffsets[pos.row])
        let x = Self.rowHeaderWidth + x0 - (pos.col < grid.frozenCols ? 0 : ox)
        let y = Self.headerHeight + y0 - (pos.row < grid.frozenRows ? 0 : oy)
        return CGRect(x: x, y: y, width: CGFloat(grid.width(pos.col)), height: CGFloat(grid.height(pos.row)))
    }

    /// The cell under a point in the view, or nil over the headers.
    func cell(at point: CGPoint) -> GridPos? {
        guard let grid else { return nil }
        let p = CGPoint(x: (point.x - contentOffset.x) / scale, y: (point.y - contentOffset.y) / scale)
        guard p.x > Self.rowHeaderWidth, p.y > Self.headerHeight else { return nil }
        let fx = p.x - Self.rowHeaderWidth
        let fy = p.y - Self.headerHeight
        let ox = contentOffset.x / scale
        let oy = contentOffset.y / scale
        let col = fx < CGFloat(grid.frozenWidth) ? grid.col(at: Double(fx)) : grid.col(at: Double(fx + ox))
        let row = fy < CGFloat(grid.frozenHeight) ? grid.row(at: Double(fy)) : grid.row(at: Double(fy + oy))
        return GridPos(row: row, col: col)
    }

    /// Scroll so a cell is visible past the frozen panes.
    private func reveal(_ pos: GridPos) {
        guard let grid, pos.row < grid.rowCount, pos.col < grid.colCount else { return }
        let viewW = bounds.width / scale
        let viewH = bounds.height / scale
        var ox = contentOffset.x / scale
        var oy = contentOffset.y / scale
        let fixedW = Self.rowHeaderWidth + CGFloat(grid.frozenWidth)
        let fixedH = Self.headerHeight + CGFloat(grid.frozenHeight)
        if pos.col >= grid.frozenCols {
            let left = CGFloat(grid.colOffsets[pos.col])
            let right = CGFloat(grid.colOffsets[pos.col + 1])
            if Self.rowHeaderWidth + left - ox < fixedW { ox = left + Self.rowHeaderWidth - fixedW }
            if Self.rowHeaderWidth + right - ox > viewW { ox = Self.rowHeaderWidth + right - viewW }
        }
        if pos.row >= grid.frozenRows {
            let top = CGFloat(grid.rowOffsets[pos.row])
            let bottom = CGFloat(grid.rowOffsets[pos.row + 1])
            if Self.headerHeight + top - oy < fixedH { oy = top + Self.headerHeight - fixedH }
            if Self.headerHeight + bottom - oy > viewH - 8 { oy = Self.headerHeight + bottom - viewH + 8 }
        }
        let maxX = max(0, contentSize.width - bounds.width)
        let maxY = max(0, contentSize.height - bounds.height + adjustedContentInset.bottom)
        setContentOffset(
            CGPoint(x: min(max(0, ox * scale), maxX), y: min(max(0, oy * scale), maxY)), animated: true)
    }

    // MARK: Gestures

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard let pos = cell(at: g.location(in: self)) else { return }
        tappedSelection = pos
        onSelect?(pos)
    }

    @objc private func doubleTapped(_ g: UITapGestureRecognizer) {
        guard let pos = cell(at: g.location(in: self)) else { return }
        onDoubleTap?(pos)
    }

    @objc private func pinched(_ g: UIPinchGestureRecognizer) {
        guard g.state == .changed || g.state == .ended else { return }
        let focal = g.location(in: self)
        let onScreen = CGPoint(x: focal.x - contentOffset.x, y: focal.y - contentOffset.y)
        let next = min(3, max(0.5, scale * g.scale))
        g.scale = 1
        guard next != scale else { return }
        let ratio = next / scale
        scale = next
        updateContentSize()
        let maxX = max(0, contentSize.width - bounds.width)
        let maxY = max(0, contentSize.height - bounds.height)
        contentOffset = CGPoint(
            x: min(max(0, focal.x * ratio - onScreen.x), maxX), y: min(max(0, focal.y * ratio - onScreen.y), maxY))
        canvas.setNeedsDisplay()
    }
}

/// Draws the visible part of the grid, pinned over the scroll view's bounds.
final class GridCanvas: UIView {
    weak var owner: GridScrollView?

    private static let ink = UIColor(Theme.ink)
    private static let line = UIColor(Theme.line)
    private static let lineStrong = UIColor(Theme.lineStrong)
    private static let header = UIColor(Theme.header)
    private static let text3 = UIColor(Theme.text3)
    private static let lime = UIColor(Theme.lime)
    private static let marker = UIColor(red: 0.93, green: 0.63, blue: 0, alpha: 1)

    override func draw(_ rect: CGRect) {
        guard let owner, let grid = owner.grid, let ctx = UIGraphicsGetCurrentContext() else { return }
        let scale = owner.scale
        ctx.scaleBy(x: scale, y: scale)
        let w = bounds.width / scale
        let h = bounds.height / scale
        let ox = owner.contentOffset.x / scale
        let oy = owner.contentOffset.y / scale
        let hw = GridScrollView.rowHeaderWidth
        let hh = GridScrollView.headerHeight
        let fw = CGFloat(grid.frozenWidth)
        let fh = CGFloat(grid.frozenHeight)

        // Which rows and columns show in the scrolling area.
        let scrollCols = grid.cols(from: Double(fw + max(0, ox)), to: Double(ox + w - hw))
        let scrollRows = grid.rows(from: Double(fh + max(0, oy)), to: Double(oy + h - hh))
        let frozenCols = 0..<grid.frozenCols
        let frozenRows = 0..<grid.frozenRows
        let scrollColList = Array(scrollCols).filter { $0 >= grid.frozenCols }
        let scrollRowList = Array(scrollRows).filter { $0 >= grid.frozenRows }

        func region(_ r: CGRect, rows: [Int], cols: [Int]) {
            ctx.saveGState()
            ctx.clip(to: r)
            for row in rows {
                for col in cols {
                    let pos = GridPos(row: row, col: col)
                    if let frame = owner.cellRect(pos) { drawCell(pos, in: frame, grid: grid, ctx: ctx) }
                }
            }
            ctx.restoreGState()
        }
        // Scrolling body, then the frozen panes over it.
        region(CGRect(x: hw + fw, y: hh + fh, width: w, height: h), rows: scrollRowList, cols: scrollColList)
        region(CGRect(x: hw + fw, y: hh, width: w, height: fh), rows: Array(frozenRows), cols: scrollColList)
        region(CGRect(x: hw, y: hh + fh, width: fw, height: h), rows: scrollRowList, cols: Array(frozenCols))
        region(CGRect(x: hw, y: hh, width: fw, height: fh), rows: Array(frozenRows), cols: Array(frozenCols))

        // Selection, clipped to its pane.
        if let sel = owner.selected, let frame = owner.cellRect(sel) {
            ctx.saveGState()
            let clipX = sel.col < grid.frozenCols ? hw : hw + fw
            let clipY = sel.row < grid.frozenRows ? hh : hh + fh
            ctx.clip(to: CGRect(x: clipX, y: clipY, width: w, height: h))
            ctx.setStrokeColor(Self.ink.cgColor)
            ctx.setLineWidth(2)
            ctx.stroke(frame.insetBy(dx: 1, dy: 1))
            ctx.restoreGState()
        }

        // Column headers.
        let headerFont = UIFont.systemFont(ofSize: 11.5, weight: .semibold)
        func colHeader(_ col: Int) {
            guard let frame = owner.cellRect(GridPos(row: 0, col: col)) else { return }
            let r = CGRect(x: frame.minX, y: 0, width: frame.width, height: hh)
            let on = owner.selected?.col == col
            fill(r, on ? Self.lime.withAlphaComponent(0.45) : Self.header, ctx)
            gridLines(r, ctx)
            text(A1.column(col), in: r, font: headerFont, color: on ? Self.ink : Self.text3, align: .center)
        }
        ctx.saveGState()
        ctx.clip(to: CGRect(x: hw + fw, y: 0, width: w, height: hh))
        scrollColList.forEach(colHeader)
        ctx.restoreGState()
        frozenCols.forEach(colHeader)

        // Row headers.
        func rowHeader(_ row: Int) {
            guard let frame = owner.cellRect(GridPos(row: row, col: 0)) else { return }
            let r = CGRect(x: 0, y: frame.minY, width: hw, height: frame.height)
            let on = owner.selected?.row == row
            fill(r, on ? Self.lime.withAlphaComponent(0.45) : Self.header, ctx)
            gridLines(r, ctx)
            text("\(row + 1)", in: r, font: headerFont, color: on ? Self.ink : Self.text3, align: .center)
        }
        ctx.saveGState()
        ctx.clip(to: CGRect(x: 0, y: hh + fh, width: hw, height: h))
        scrollRowList.forEach(rowHeader)
        ctx.restoreGState()
        frozenRows.forEach(rowHeader)

        // Corner, and the frozen-pane edges.
        let corner = CGRect(x: 0, y: 0, width: hw, height: hh)
        fill(corner, Self.header, ctx)
        gridLines(corner, ctx)
        ctx.setStrokeColor(Self.lineStrong.cgColor)
        ctx.setLineWidth(1.5)
        if grid.frozenRows > 0 {
            ctx.strokeLineSegments(between: [CGPoint(x: 0, y: hh + fh), CGPoint(x: w, y: hh + fh)])
        }
        if grid.frozenCols > 0 {
            ctx.strokeLineSegments(between: [CGPoint(x: hw + fw, y: 0), CGPoint(x: hw + fw, y: h)])
        }
    }

    private func drawCell(_ pos: GridPos, in frame: CGRect, grid: SheetGrid, ctx: CGContext) {
        let cell = grid.cells[pos]
        let look = cell?.look ?? CellLook()
        fill(frame, look.fill.map(Self.color) ?? .white, ctx)
        gridLines(frame, ctx)
        if let cell, !cell.text.isEmpty {
            var traits: UIFontDescriptor.SymbolicTraits = []
            if look.bold { traits.insert(.traitBold) }
            if look.italic { traits.insert(.traitItalic) }
            var font = UIFont.monospacedSystemFont(ofSize: 13, weight: look.bold ? .bold : .regular)
            if look.italic, let d = font.fontDescriptor.withSymbolicTraits(traits) { font = UIFont(descriptor: d, size: 13) }
            let align: NSTextAlignment =
                switch look.align {
                case "center": .center
                case "right": .right
                default: .left
                }
            text(
                cell.text, in: frame.insetBy(dx: 4, dy: 0), font: font, color: look.color.map(Self.color) ?? Self.ink,
                align: align, underline: look.underline, strike: look.strike, wrap: look.wrap)
        }
        if grid.commented.contains(pos) {
            let path = UIBezierPath()
            path.move(to: CGPoint(x: frame.maxX - 7, y: frame.minY))
            path.addLine(to: CGPoint(x: frame.maxX, y: frame.minY))
            path.addLine(to: CGPoint(x: frame.maxX, y: frame.minY + 7))
            path.close()
            Self.marker.setFill()
            path.fill()
        }
    }

    private func fill(_ r: CGRect, _ color: UIColor, _ ctx: CGContext) {
        ctx.setFillColor(color.cgColor)
        ctx.fill(r)
    }

    private func gridLines(_ r: CGRect, _ ctx: CGContext) {
        ctx.setStrokeColor(Self.line.cgColor)
        ctx.setLineWidth(0.5)
        ctx.strokeLineSegments(between: [
            CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY),
            CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY),
        ])
    }

    private func text(
        _ s: String, in r: CGRect, font: UIFont, color: UIColor, align: NSTextAlignment,
        underline: Bool = false, strike: Bool = false, wrap: Bool = false
    ) {
        let para = NSMutableParagraphStyle()
        para.alignment = align
        para.lineBreakMode = wrap ? .byWordWrapping : .byTruncatingTail
        var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para]
        if underline { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        let str = NSAttributedString(string: wrap ? s : s.replacingOccurrences(of: "\n", with: " "), attributes: attrs)
        if wrap {
            str.draw(with: r.insetBy(dx: 0, dy: 3), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
        } else {
            let height = font.lineHeight
            str.draw(in: CGRect(x: r.minX, y: r.midY - height / 2, width: r.width, height: height))
        }
    }

    private static func color(_ hex: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1)
    }
}
