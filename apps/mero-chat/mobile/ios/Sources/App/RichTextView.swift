import SwiftUI

/// A message body drawn the way the web app's bubble styles it: 13px text at
/// 1.5 line height, 6px between paragraphs, code on the sunken ground,
/// quotes with an accent bar, links and mentions in accent.
struct RichTextView: View {
    let rich: RichText
    var size: CGFloat = 13

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(rich.blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func blockView(_ block: RichText.Block) -> some View {
        switch block {
        case .paragraph(let runs):
            Text(attributed(runs))
                .lineSpacing(size * 0.5)
                .textSelection(.enabled)
        case .quote(let runs):
            Text(attributed(runs))
                .lineSpacing(size * 0.5)
                .padding(.vertical, 4)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.sunken)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.accent).frame(width: 3) }
        case .code(let code):
            Text(code)
                .font(.system(size: size - 1, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunken))
                .textSelection(.enabled)
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, runs in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(ordered ? "\(i + 1)." : "•")
                            .font(Theme.font(size))
                            .foregroundStyle(Theme.ink)
                        Text(attributed(runs)).lineSpacing(size * 0.5)
                    }
                }
            }
            .padding(.leading, 16)
        }
    }

    private func attributed(_ runs: [RichText.Run]) -> AttributedString {
        var out = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            let weight: Font.Weight = run.style.contains(.bold) ? .bold : .regular
            if run.style.contains(.code) {
                piece.font = .system(size: size - 1, design: .monospaced)
                piece.backgroundColor = Theme.sunken
            } else {
                var font = Theme.font(size, weight)
                if run.style.contains(.italic) { font = font.italic() }
                piece.font = font
            }
            piece.foregroundColor = Theme.ink
            if run.style.contains(.underline) { piece.underlineStyle = .single }
            if run.style.contains(.strike) { piece.strikethroughStyle = .single }
            if let link = run.link, let url = URL(string: link) {
                piece.link = url
                piece.foregroundColor = Theme.accent
            }
            if let mention = run.mention {
                piece.foregroundColor = Theme.accent
                piece.backgroundColor = mention == .user ? Theme.accent(12) : Theme.accent(5)
            }
            out += piece
        }
        return out
    }
}
