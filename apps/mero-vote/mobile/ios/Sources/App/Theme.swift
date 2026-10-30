import VoteCore
import CoreTransferable
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Calimero light: lime accent fills with ink text on them, near-black ink,
/// white and very light grey surfaces, hairline borders. Android `Theme.kt`
/// holds the same values.
enum Palette {
    static let lime = Color(hex: 0xA5FF11)
    static let limeSoft = Color(hex: 0xEEFFD1)
    static let ink = Color(hex: 0x0B0B0C)
    static let inkSoft = Color(hex: 0x3C4049)
    static let muted = Color(hex: 0x6B7080)
    static let ground = Color(hex: 0xF5F6F8)
    static let surface = Color.white
    static let sunken = Color(hex: 0xF0F1F4)
    static let hairline = Color(hex: 0xE3E5EA)
    static let danger = Color(hex: 0xC2214E)
    static let dangerSoft = Color(hex: 0xFFE7EC)
    static let success = Color(hex: 0x2F7D1F)
    static let successSoft = Color(hex: 0xE9F9D4)
    static let warning = Color(hex: 0x8A5A00)
    static let warningSoft = Color(hex: 0xFFF3D6)
    static let info = Color(hex: 0x23408F)
    static let infoSoft = Color(hex: 0xE5ECFF)

    /// Avatar tones, picked by ``VoteFormat/tone(_:tones:)``: background, ink.
    static let tones: [(Color, Color)] = [
        (Color(hex: 0xE4F9C4), Color(hex: 0x2F5000)),
        (Color(hex: 0xDDE7FF), Color(hex: 0x23408F)),
        (Color(hex: 0xFFE4D1), Color(hex: 0x8A3B0B)),
        (Color(hex: 0xF3DDFB), Color(hex: 0x6A1E86)),
        (Color(hex: 0xD5F4EE), Color(hex: 0x0D5E50)),
        (Color(hex: 0xFFF1C2), Color(hex: 0x6B4E00)),
    ]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

enum Typeface {
    /// Power Grotesk when bundled, the system face otherwise.
    static func display(_ size: CGFloat, bold: Bool = true) -> Font {
        let name = bold ? "PowerGrotesk-Bold" : "PowerGrotesk-Regular"
        if UIFont(name: name, size: size) != nil { return .custom(name, size: size) }
        return .system(size: size, weight: bold ? .bold : .regular)
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func failure() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

// MARK: - Buttons

/// Lime fill, ink text: the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 15 : 17, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, compact ? 16 : 20)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 34 : 50)
            .background(Capsule().fill(Palette.lime))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

/// Outlined, for the second action.
struct SecondaryButtonStyle: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 15 : 17, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, compact ? 16 : 20)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 34 : 50)
            .background(Capsule().fill(Palette.surface))
            .overlay(Capsule().stroke(Palette.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Pieces

/// A person's (round) or a place's (rounded square) initials on a tone.
struct Avatar: View {
    let label: String
    var seed: String?
    var size: CGFloat = 40
    var square = false
    var symbol: String?

    var body: some View {
        let tone = Palette.tones[VoteFormat.tone(seed ?? label)]
        ZStack {
            if square {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(tone.0)
            } else {
                Circle().fill(tone.0)
            }
            if let symbol {
                Image(systemName: symbol).font(.system(size: size * 0.42, weight: .semibold))
            } else {
                Text(VoteFormat.initial(label))
                    .font(.system(size: size * 0.38, weight: .bold))
            }
        }
        .foregroundStyle(tone.1)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// White, rounded, hairline-bordered.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(Palette.ink)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Palette.limeSoft))
            Text(title).font(Typeface.display(20))
                .foregroundStyle(Palette.ink)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            if let action {
                Button(action.title, action: action.run)
                    .buttonStyle(PrimaryButtonStyle(compact: true))
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Palette.danger)
                .frame(width: 60, height: 60)
                .background(Circle().fill(Palette.dangerSoft))
            Text("Couldn't load this").font(Typeface.display(19)).foregroundStyle(Palette.ink)
            Text(message).font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            Button("Try again", action: retry).buttonStyle(SecondaryButtonStyle(compact: true))
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

/// A dismissable line at the top of a screen for a failed action.
struct NoticeBanner: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.danger)
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink)
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.dangerSoft))
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

/// Ids and other technical values, folded away behind "Details".
struct DetailsDisclosure: View {
    let rows: [(String, String)]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle")
                    Text("Details")
                    Spacer()
                    Image(systemName: "chevron.down").rotationEffect(.degrees(open ? 180 : 0))
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.inkSoft)
                .padding(.vertical, 12)
            }
            if open {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows.filter { !$0.1.isEmpty }, id: \.0) { row in
                        CopyRow(label: row.0, value: row.1)
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}

struct CopyRow: View {
    let label: String
    let value: String
    @State private var copied = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
                Text(value).font(.system(size: 13, design: .monospaced)).foregroundStyle(Palette.ink)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer()
            Button {
                UIPasteboard.general.string = value
                copied = true
                Haptics.tap()
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14))
                    .foregroundStyle(Palette.inkSoft)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
    }
}

/// A lime pill that says something is done or yours.
struct Badge: View {
    let text: String
    var strong = true

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(strong ? Palette.lime : Palette.sunken))
    }
}

/// The sheet header every create/edit sheet shares: Cancel, a title, and the action.
struct SheetBar: View {
    let title: String
    let action: String
    let canAct: Bool
    let busy: Bool
    let cancel: () -> Void
    let act: () -> Void

    var body: some View {
        HStack {
            Button("Cancel", action: cancel)
                .font(.system(size: 16))
                .foregroundStyle(Palette.ink)
                .disabled(busy)
            Spacer()
            Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
            Spacer()
            Button(action: act) {
                if busy {
                    ProgressView().tint(Palette.ink).frame(minWidth: 44)
                } else {
                    Text(action)
                }
            }
            .buttonStyle(PrimaryButtonStyle(compact: true))
            .disabled(!canAct || busy)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }
}

extension View {
    /// The nav bar every screen shares: white, inline, ink.
    func voteNavigation(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

// MARK: - Vote pieces

/// Danger-filled: close or seal, the creator's one-way doors.
struct DangerButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(minHeight: 38)
            .background(Capsule().fill(Palette.danger))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

/// The poll's phase as a dot and a word.
struct PhaseBadge: View {
    let phase: Phase

    var body: some View {
        let (bg, fg) = PhaseBadge.colors(phase)
        HStack(spacing: 6) {
            Circle().fill(fg).frame(width: 6, height: 6)
            Text(VoteFormat.phaseLabel(phase))
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(fg)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(bg))
    }

    static func colors(_ phase: Phase) -> (Color, Color) {
        switch phase {
        case .keyCeremony: return (Palette.warningSoft, Palette.warning)
        case .voting: return (Palette.lime, Palette.ink)
        case .closing: return (Palette.infoSoft, Palette.info)
        case .closed: return (Palette.sunken, Palette.inkSoft)
        }
    }
}

enum CalloutTone {
    case success, danger, warning, info

    var colors: (Color, Color) {
        switch self {
        case .success: return (Palette.successSoft, Palette.success)
        case .danger: return (Palette.dangerSoft, Palette.danger)
        case .warning: return (Palette.warningSoft, Palette.warning)
        case .info: return (Palette.infoSoft, Palette.info)
        }
    }

    var symbol: String {
        switch self {
        case .success: return "checkmark.shield.fill"
        case .danger, .warning: return "exclamationmark.triangle"
        case .info: return "info.circle"
        }
    }
}

/// A tinted box with an icon, a bold line and an optional second line.
struct Callout: View {
    let tone: CalloutTone
    let title: String
    var message: String?
    var symbol: String?

    var body: some View {
        let (bg, fg) = tone.colors
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol ?? tone.symbol).foregroundStyle(fg).font(.system(size: 16, weight: .semibold))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 14, weight: message == nil ? .regular : .semibold))
                if let message { Text(message).font(.system(size: 14)) }
            }
            .foregroundStyle(Palette.ink)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(bg))
    }
}

/// A success line at the top of a screen for an action that worked.
struct SuccessBanner: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark").foregroundStyle(Palette.success).font(.system(size: 14, weight: .bold))
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink)
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.successSoft))
    }
}

/// A rounded icon tile at the head of a card, lime when it is the card's moment.
struct IconTile: View {
    let symbol: String
    var accent = false

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .frame(width: 38, height: 38)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(accent ? Palette.lime : Palette.sunken))
    }
}

/// A card's head: tile, title, optional meta line, optional trailing view.
struct CardHead<Trailing: View>: View {
    let symbol: String
    var accent = false
    let title: String
    var meta: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(symbol: symbol, accent: accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typeface.display(19)).foregroundStyle(Palette.ink)
                if let meta { Text(meta).font(.system(size: 14)).foregroundStyle(Palette.muted) }
            }
            Spacer(minLength: 0)
            trailing
        }
    }
}

extension CardHead where Trailing == EmptyView {
    init(symbol: String, accent: Bool = false, title: String, meta: String? = nil) {
        self.init(symbol: symbol, accent: accent, title: title, meta: meta) { EmptyView() }
    }
}

/// A card with the standard inner padding.
struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) { content }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Done / waiting / not applicable, as an icon and a word.
struct StatusLine: View {
    enum State { case done(String), waiting, none }
    let label: String
    let state: State

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 13)).foregroundStyle(Palette.muted)
            Spacer()
            switch state {
            case .done(let word):
                Label(word, systemImage: "checkmark").foregroundStyle(Palette.success)
            case .waiting:
                Label("Waiting", systemImage: "clock").foregroundStyle(Palette.warning)
            case .none:
                Text("—").foregroundStyle(Palette.muted).accessibilityLabel("not applicable")
            }
        }
        .font(.system(size: 13, weight: .medium))
    }
}

/// A list of audit checks: a mark, the check's name, and its detail.
struct CheckList: View {
    let checks: [AuditCheck]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(checks) { c in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: c.ok ? "checkmark" : "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(c.ok ? Palette.ink : .white)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(c.ok ? Palette.lime : Palette.danger))
                        .accessibilityLabel(c.ok ? "passed" : "failed")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(c.detail).font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                }
            }
        }
    }
}

/// A titled fold: "Details"-style, for checks and other long technical lists.
struct Disclosure<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle")
                    Text(title)
                    Spacer()
                    Image(systemName: "chevron.down").rotationEffect(.degrees(open ? 180 : 0))
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.inkSoft)
                .padding(.vertical, 8)
            }
            if open { content.padding(.top, 6) }
        }
    }
}

/// Text to share as a file (a key backup, a transcript).
struct SharedText: Transferable {
    let text: String
    let fileName: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { item in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(item.fileName)
            try item.text.write(to: url, atomically: true, encoding: .utf8)
            return SentTransferredFile(url)
        }
    }
}

extension CloudStyle {
    /// The sign-in and approvals views in Mero Vote's colours.
    static let app = CloudStyle(
        ink: Palette.ink, muted: Palette.muted, accent: Palette.lime, onAccent: Palette.ink, danger: Palette.danger,
        field: Palette.surface, hairline: Palette.hairline)
}
