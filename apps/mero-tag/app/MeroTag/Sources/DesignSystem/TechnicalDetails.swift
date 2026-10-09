import SwiftUI

/// One row of technical details.
struct DetailItem: Identifiable {
    let label: String
    let value: String
    var copyable = true
    var id: String { label }
}

/// "Show technical details": IDs, keys and URLs stay out of the way behind a
/// disclosure at the bottom of a card (vote `details.tech`).
struct TechnicalDetails: View {
    let items: [DetailItem]
    var title = "Show technical details"
    var showsDivider = true

    @State private var isOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsDivider {
                Hairline().padding(.bottom, 12)
            }
            Button {
                withAnimation(.easeOut(duration: 0.18)) { isOpen.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                    Text(isOpen ? "Hide technical details" : title)
                        .font(Cal.Typeface.label)
                    Spacer()
                }
                .foregroundStyle(Cal.textFaint)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("technicalDetailsToggle")
            .accessibilityValue(isOpen ? "expanded" : "collapsed")

            if isOpen {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.label).font(Cal.Typeface.hint).foregroundStyle(Cal.textFaint)
                            IdField(value: item.value, copyable: item.copyable)
                        }
                    }
                }
                .padding(.top, 10)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

/// Monospaced, sunken, ellipsized value with a copy button.
struct IdField: View {
    let value: String
    var copyable = true

    @State private var copied = false

    var body: some View {
        HStack(spacing: 4) {
            Text(value)
                .font(Cal.Typeface.mono)
                .foregroundStyle(Cal.textDim)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 4)
            if copyable {
                Button {
                    Platform.copy(value)
                    Platform.success()
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copied = false
                    }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(copied ? Cal.accentInk : Cal.textFaint)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copied ? "Copied" : "Copy")
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, copyable ? 2 : 10)
        .frame(minHeight: 30)
        .background(RoundedRectangle(cornerRadius: Cal.Radius.id, style: .continuous).fill(Cal.surfaceSunken))
        .overlay(
            RoundedRectangle(cornerRadius: Cal.Radius.id, style: .continuous)
                .strokeBorder(Cal.border, lineWidth: 1))
    }
}

/// Label / value row (vote `.kv`): faint label column, value on the right.
struct KeyValueRow: View {
    let label: String
    let value: String
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(Cal.Typeface.hint)
                .foregroundStyle(Cal.textFaint)
            Spacer(minLength: 8)
            Text(value)
                .font(monospaced ? Cal.Typeface.mono : Cal.Typeface.bodySmall)
                .foregroundStyle(Cal.ink)
                .monospacedDigit()
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}
