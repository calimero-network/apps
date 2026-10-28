import ChessCore
import SwiftUI

/// The board: flat squares, the contract's legal moves as dots and rings, tap-tap to move.
///
/// Tap-to-select rather than drag: it works the same with a finger and VoiceOver, and a slipped
/// drop cannot send a move nobody meant. Every square it offers comes from the contract's
/// legal-move list; there is no engine here.
struct BoardView: View {
    @ObservedObject var model: TableModel

    var body: some View {
        let squares = model.squares
        let order = Board.displayOrder(flipped: model.flipped)
        let targets = model.targets
        let movable = model.movable
        let last = model.lastMove
        let check = model.inCheck
        let leftFile = model.flipped ? 7 : 0
        let bottomRank = model.flipped ? 7 : 0

        GeometryReader { geometry in
            let side = geometry.size.width / 8
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 0), count: 8), spacing: 0) {
                ForEach(order, id: \.self) { index in
                    let name = Board.squareName(index)
                    let piece = squares[index]
                    SquareView(
                        index: index, piece: piece, side: side,
                        selected: model.selected == name,
                        target: targets.contains(name),
                        last: last.map { $0.from == name || $0.to == name } ?? false,
                        checked: piece?.kind == "k" && piece?.color == check,
                        rankLabel: index % 8 == leftFile ? "\(index / 8 + 1)" : nil,
                        fileLabel: index / 8 == bottomRank ? String(Board.files[index % 8]) : nil
                    )
                    .contentShape(Rectangle())
                    .onTapGesture {
                        guard model.interactive else { return }
                        if movable.contains(name) || targets.contains(name) || model.selected != nil { Haptics.tap() }
                        Task { await model.tap(name) }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(piece.map { "\(name), \($0.spokenName)" } ?? name)
                    .accessibilityAddTraits(model.interactive && (movable.contains(name) || targets.contains(name)) ? .isButton : [])
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line, lineWidth: Theme.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Chess board")
    }
}

private struct SquareView: View {
    let index: Int
    let piece: Piece?
    let side: CGFloat
    let selected: Bool
    let target: Bool
    let last: Bool
    let checked: Bool
    let rankLabel: String?
    let fileLabel: String?

    var body: some View {
        let dark = Board.isDark(index)
        ZStack {
            Rectangle().fill(dark ? Theme.squareDark : Theme.squareLight)
            if last { Rectangle().fill(Theme.squareLast) }
            if selected { Rectangle().fill(Theme.squareSelected) }
            if checked {
                RadialGradient(
                    colors: [Theme.squareCheck, Theme.squareCheck.opacity(0)], center: .center, startRadius: 0,
                    endRadius: side * 0.62)
            }
            if let piece {
                PieceImage(assetName: piece.assetName).padding(side * 0.06)
            }
            if target {
                if piece == nil {
                    Circle().fill(Theme.squareHint).frame(width: side * 0.3, height: side * 0.3)
                } else {
                    Circle().strokeBorder(Theme.squareHint, lineWidth: side * 0.08).padding(side * 0.02)
                }
            }
            coordinates(dark: dark)
        }
        .frame(width: side, height: side)
    }

    @ViewBuilder
    private func coordinates(dark: Bool) -> some View {
        let color = dark ? Theme.squareLight : Theme.squareDark
        if let rankLabel {
            Text(rankLabel).font(.system(size: max(8, side * 0.2), weight: .semibold)).foregroundStyle(color)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(side * 0.05)
        }
        if let fileLabel {
            Text(fileLabel).font(.system(size: max(8, side * 0.2), weight: .semibold)).foregroundStyle(color)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing).padding(side * 0.05)
        }
    }
}
