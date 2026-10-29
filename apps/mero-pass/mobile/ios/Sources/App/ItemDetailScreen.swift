import PassCore
import SwiftUI

/// One item: its fields with reveal and copy, the live authenticator code,
/// strength, tags, who changed it, previous values, edit, share and trash.
struct ItemDetailScreen: View {
    @ObservedObject var model: VaultModel
    let secretId: String
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var revealed: Set<String> = []
    @State private var history: [Revision]?
    @State private var editing = false
    @State private var sharing = false
    @State private var confirmTrash = false

    var body: some View {
        Group {
            if let secret = model.secret(secretId) {
                content(secret)
            } else {
                EmptyState(symbol: "tray", title: "This item is gone", message: "It was moved or deleted on another device.")
            }
        }
        .background(Palette.ground)
        .passNavigation("")
    }

    private func content(_ secret: Secret) -> some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Tile(name: secret.name, size: 56)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(secret.name).font(Typeface.display(24)).foregroundStyle(Palette.ink)
                        Label(SecretKind.label(of: secret.kind), systemImage: KindIcon.symbol(secret.kind))
                            .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                if secret.unreadable {
                    Banner(
                        tone: .warn, symbol: "lock", title: nil,
                        text: "Part of this item is sealed under a key this phone never received."
                    )
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                }
            }

            Section {
                ForEach(ItemView.orderedFields(secret), id: \.key) { field in
                    FieldRow(
                        kind: secret.kind, key: field.key, label: field.label, value: field.value,
                        revealed: revealed.contains(field.key),
                        toggle: {
                            if revealed.contains(field.key) { revealed.remove(field.key) } else { revealed.insert(field.key) }
                        },
                        copy: { services.copySecret(field.value, what: field.label) },
                        open: field.key == "url" ? ItemView.openableURL(field.value).map { url in { openURL(url) } } : nil)
                }
            }

            if !secret.tags.isEmpty {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(secret.tags, id: \.self) { tag in
                                Label(tag, systemImage: "tag").font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Palette.ink)
                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(Capsule().fill(Palette.sunken))
                            }
                        }
                    }
                } header: {
                    SectionLabel(text: "Tags")
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Modified \(stamp(secret.updatedAt)) by \(ItemView.who(secret.updatedBy, me: model.me))")
                    Text("Created \(stamp(secret.createdAt)) by \(ItemView.who(secret.createdBy, me: model.me))")
                }
                .font(.system(size: 13)).foregroundStyle(Palette.muted)
                Button {
                    Task {
                        if history == nil { history = await model.history(secret.id) } else { history = nil }
                    }
                } label: {
                    Label(history == nil ? "Previous values" : "Hide previous values", systemImage: "clock.arrow.circlepath")
                }
                .foregroundStyle(Palette.ink)
                if let history {
                    if history.isEmpty {
                        Text("No earlier values.").font(.system(size: 14)).foregroundStyle(Palette.muted)
                    }
                    ForEach(Array(history.enumerated()), id: \.offset) { _, revision in
                        RevisionRow(
                            revision: revision, kind: secret.kind, me: model.me, canRestore: model.canWrite,
                            restore: {
                                Task {
                                    if await model.restoreRevision(revision, of: secret) {
                                        services.show("Restored.")
                                        self.history = await model.history(secret.id)
                                    }
                                }
                            })
                    }
                }
            }

            if model.canWrite {
                Section {
                    Button(role: .destructive) {
                        confirmTrash = true
                    } label: {
                        Label("Move to trash", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !secret.unreadable {
                    Button {
                        sharing = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
                if model.canWrite && !secret.unreadable {
                    Button("Edit") { editing = true }.fontWeight(.semibold)
                }
            }
        }
        .confirmationDialog("Move “\(secret.name)” to the trash?", isPresented: $confirmTrash, titleVisibility: .visible) {
            Button("Move to trash", role: .destructive) {
                Task {
                    if await model.trash(secret.id) {
                        services.show("Moved to trash.")
                        dismiss()
                    }
                }
            }
        } message: {
            Text("It stays recoverable in the trash until an Admin deletes it for good.")
        }
        .sheet(isPresented: $editing) {
            ItemEditorSheet(model: model, editing: secret, initialKind: SecretKind(rawValue: secret.kind) ?? .login) { _ in
                services.show("Saved, encrypted on this phone.")
                history = nil
            }
        }
        .sheet(isPresented: $sharing) {
            ShareSecretSheet(secret: secret)
        }
        .onDisappear { revealed = [] }
    }

    private func stamp(_ value: UInt64) -> String {
        ItemView.date(value).formatted(date: .abbreviated, time: .shortened)
    }
}

/// One field: masked until revealed when sensitive, a live code for a seed.
struct FieldRow: View {
    let kind: String
    let key: String
    let label: String
    let value: String
    let revealed: Bool
    let toggle: () -> Void
    let copy: () -> Void
    let open: (() -> Void)?

    var body: some View {
        let sensitive = SecretKind.isSensitive(kind: kind, field: key)
        let totp = SecretKind.isTotpField(kind: kind, field: key)
        let shown = !sensitive || revealed
        VStack(alignment: .leading, spacing: 6) {
            Text(totp ? "One-time code" : label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
            if totp {
                TotpView(seed: value)
            } else {
                HStack(alignment: .top, spacing: 8) {
                    Text(shown ? value : "••••••••••••")
                        .font(.system(size: 16, design: sensitive ? .monospaced : .default))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(SecretKind.isMultiline(kind: kind, field: key) ? nil : 2)
                        .textSelection(.disabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if sensitive {
                        IconButton(symbol: revealed ? "eye.slash" : "eye", label: revealed ? "Hide \(label)" : "Reveal \(label)", action: toggle)
                    }
                    if let open { IconButton(symbol: "arrow.up.right.square", label: "Open website", action: open) }
                    IconButton(symbol: "doc.on.doc", label: "Copy \(label)", action: copy)
                }
                if key == "password" && shown {
                    StrengthMeter(score: PasswordTools.strength(value))
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Palette.inkSoft)
                .frame(width: 34, height: 34)
                .background(Circle().fill(Palette.sunken))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
    }
}

struct StrengthMeter: View {
    let score: Int

    var body: some View {
        HStack(spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.sunken)
                    Capsule().fill(Palette.strength(score)).frame(width: geo.size.width * CGFloat(score + 1) / 5)
                }
            }
            .frame(height: 6)
            Text(PasswordTools.strengthLabels[score]).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.strength(score))
                .frame(width: 80, alignment: .leading)
        }
    }
}

/// The six (or eight) digits, refreshed every period, with a ring for the time left.
struct TotpView: View {
    let seed: String
    @EnvironmentObject private var services: AppServices

    var body: some View {
        if let params = Totp.parse(seed) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let ms = Int64(context.date.timeIntervalSince1970 * 1000)
                let code = Totp.code(params, atMs: ms)
                let left = Totp.secondsRemaining(period: params.period, atMs: ms)
                HStack(spacing: 12) {
                    Text(grouped(code))
                        .font(.system(size: 26, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Palette.ink)
                    ZStack {
                        Circle().stroke(Palette.sunken, lineWidth: 3)
                        Circle().trim(from: 0, to: CGFloat(left) / CGFloat(params.period))
                            .stroke(left <= 5 ? Palette.danger : Palette.ink, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(left)").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkSoft)
                    }
                    .frame(width: 26, height: 26)
                    .accessibilityLabel("\(left) seconds left")
                    Spacer()
                    IconButton(symbol: "doc.on.doc", label: "Copy code") { services.copySecret(code, what: "Code") }
                }
            }
        } else {
            Text("Not a valid authenticator seed").font(.system(size: 14)).foregroundStyle(Palette.danger)
        }
    }

    private func grouped(_ code: String) -> String {
        let mid = code.index(code.startIndex, offsetBy: code.count / 2)
        return "\(code[..<mid]) \(code[mid...])"
    }
}

struct RevisionRow: View {
    let revision: Revision
    let kind: String
    let me: String?
    let canRestore: Bool
    let restore: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(
                    "\(revision.field.replacingOccurrences(of: "_", with: " ")) · \(ItemView.date(revision.replacedAt).formatted(date: .abbreviated, time: .shortened)) · \(ItemView.who(revision.replacedBy, me: me))"
                )
                .font(.system(size: 12)).foregroundStyle(Palette.muted)
                Text(
                    revision.unreadable
                        ? "sealed under a key this phone never had"
                        : SecretKind.isSensitive(kind: kind, field: revision.field) ? "••••••••" : revision.previous
                )
                .font(.system(size: 14, design: .monospaced)).foregroundStyle(Palette.ink).lineLimit(2)
            }
            Spacer()
            if !revision.unreadable && canRestore {
                Button("Restore", action: restore).buttonStyle(SecondaryButtonStyle(compact: true))
            }
        }
    }
}
