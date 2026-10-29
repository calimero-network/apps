import PassCore
import SwiftUI

/// New or edit item (the web's `SecretForm`): name, kind, the kind's fields,
/// the password generator, tags. Encrypted on the phone before it is saved.
struct ItemEditorSheet: View {
    @ObservedObject var model: VaultModel
    let editing: Secret?
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var kind: SecretKind
    @State private var values: [String: String]
    @State private var tags: String
    @State private var length = Double(PasswordTools.generatorDefault)
    @State private var busy = false
    @State private var error: String?

    init(model: VaultModel, editing: Secret?, initialKind: SecretKind, onSaved: @escaping (String) -> Void) {
        self.model = model
        self.editing = editing
        self.onSaved = onSaved
        _name = State(initialValue: editing?.name ?? "")
        _kind = State(initialValue: editing.flatMap { SecretKind(rawValue: $0.kind) } ?? initialKind)
        _values = State(initialValue: editing?.fields ?? [:])
        _tags = State(initialValue: editing?.tags.joined(separator: ", ") ?? "")
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: editing == nil ? "New item" : "Edit item", action: editing == nil ? "Add" : "Save",
                canAct: !name.trimmingCharacters(in: .whitespaces).isEmpty, busy: busy, cancel: { dismiss() }, act: save)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error { Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) }
                    InputField(label: "Name", text: $name, placeholder: "GitHub, Stripe, the office wifi…")
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Kind").font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.muted)
                        Menu {
                            ForEach(SecretKind.allCases) { k in
                                Button {
                                    kind = k
                                } label: {
                                    Label(k.label, systemImage: KindIcon.symbol(k.rawValue))
                                }
                            }
                        } label: {
                            HStack {
                                Label(kind.label, systemImage: KindIcon.symbol(kind.rawValue)).foregroundStyle(Palette.ink)
                                Spacer()
                                if editing == nil { Image(systemName: "chevron.up.chevron.down").foregroundStyle(Palette.muted) }
                            }
                            .font(.system(size: 16))
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                        }
                        .disabled(editing != nil)
                    }
                    ForEach(kind.fields, id: \.key) { field in
                        VStack(alignment: .leading, spacing: 8) {
                            InputField(
                                label: field.label, text: binding(field.key), secure: field.secret && !field.multiline,
                                multiline: field.multiline, monospaced: field.secret)
                            if field.generate { generator(field) }
                        }
                    }
                    InputField(label: "Tags", text: $tags, placeholder: "work, infra (comma separated)")
                    Text(
                        "Encrypted on this phone before it is saved. Every member of this vault who holds its key can read it, and Editors can change it."
                    )
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.surface)
        .interactiveDismissDisabled(busy)
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    private func generator(_ field: FieldSpec) -> some View {
        let value = values[field.key] ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            if value.isEmpty {
                Text("No \(field.label.lowercased()) yet").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted)
            } else {
                StrengthMeter(score: PasswordTools.strength(value))
            }
            HStack(spacing: 12) {
                Text("Length").font(.system(size: 13)).foregroundStyle(Palette.muted)
                Slider(
                    value: $length,
                    in: Double(PasswordTools.generatorMin)...Double(PasswordTools.generatorMax), step: 1
                )
                .tint(Palette.ink)
                .accessibilityLabel("Generated length")
                Text("\(Int(length))").font(.system(size: 13, weight: .semibold, design: .monospaced)).frame(width: 26)
                Button {
                    values[field.key] = PasswordTools.generate(length: Int(length))
                    Haptics.tap()
                } label: {
                    Label("Generate", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.hairline, lineWidth: 1))
    }

    private func save() {
        guard !busy else { return }
        busy = true
        error = nil
        let draft = SecretDraft(
            kind: kind.rawValue, name: name,
            tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            fields: values)
        Task {
            do {
                let id = try await model.save(draft, editing: editing)
                Haptics.success()
                onSaved(id)
                dismiss()
            } catch {
                self.error = PassErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Share one item with someone outside the team (the web's `ShareModal`): a
/// self-contained link that opens on the web's share page.
struct ShareSecretSheet: View {
    let secret: Secret
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @State private var include: Set<String>
    @State private var expiry = PassConstants.shareExpiries[1].seconds
    @State private var usePassphrase = true
    @State private var passphrase = ""
    @State private var link: String?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    init(secret: Secret) {
        self.secret = secret
        _include = State(initialValue: Set(secret.fields.keys.filter { $0 != "notes" && !(secret.fields[$0] ?? "").isEmpty }))
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Share “\(secret.name)”", action: link == nil ? "Create link" : nil, canAct: !include.isEmpty,
                busy: busy, cancel: { dismiss() }, act: create)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(
                        "The link carries the item itself, encrypted, after the # (the part a browser never sends to any server). It needs no account and no invitation. It cannot be revoked once sent: if it reaches the wrong person, change the password."
                    )
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    if let error { Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) }
                    if let link {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionLabel(text: "Link")
                            Text(link).font(.system(size: 12, design: .monospaced)).lineLimit(3).truncationMode(.middle)
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                            SwiftUI.ShareLink(item: link) {
                                Label("Share link", systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            Button {
                                // The link carries the item: copy it like a secret, so it expires.
                                services.copySecret(link, what: "Link")
                                copied = true
                            } label: {
                                Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            if usePassphrase {
                                Text("Tell them the passphrase another way: by phone, or in person.")
                                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                            }
                        }
                    } else {
                        SectionLabel(text: "Include")
                        ForEach(secret.fields.keys.sorted(), id: \.self) { key in
                            Toggle(isOn: Binding(
                                get: { include.contains(key) },
                                set: { if $0 { include.insert(key) } else { include.remove(key) } })
                            ) {
                                Text(key.replacingOccurrences(of: "_", with: " ").capitalized).font(.system(size: 15))
                            }
                            .tint(Palette.ink)
                        }
                        SectionLabel(text: "Stops opening after")
                        Picker("Stops opening after", selection: $expiry) {
                            ForEach(PassConstants.shareExpiries, id: \.seconds) { option in
                                Text(option.label).tag(option.seconds)
                            }
                        }
                        .pickerStyle(.segmented)
                        Toggle(isOn: $usePassphrase) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Require a passphrase").font(.system(size: 15, weight: .medium))
                                Text("Recommended: then the link alone is useless.").font(.system(size: 13)).foregroundStyle(Palette.muted)
                            }
                        }
                        .tint(Palette.ink)
                        if usePassphrase {
                            InputField(label: "Passphrase you will tell them separately", text: $passphrase, secure: true)
                        }
                    }
                }
                .padding(20)
            }
        }
        .background(Palette.surface)
    }

    private func create() {
        error = nil
        if usePassphrase && passphrase.count < PassConstants.minSharePassphrase {
            error = "Use a passphrase of at least 6 characters, and tell it to them another way."
            return
        }
        busy = true
        let payload = SecretShare.Payload(
            name: secret.name, kind: secret.kind, fields: secret.fields.filter { include.contains($0.key) },
            expiresAt: Int64((Date().timeIntervalSince1970 + Double(expiry)) * 1000))
        let pass = usePassphrase ? passphrase : nil
        Task {
            // 600,000 PBKDF2 rounds: off the main thread.
            let result = await Task.detached { () -> Result<String, Error> in
                Result { SecretShare.url(fragment: try SecretShare.createFragment(payload, passphrase: pass)) }
            }.value
            switch result {
            case .success(let url):
                link = url
                Haptics.success()
            case .failure(let failure):
                error = PassErrorText.describe(failure)
            }
            busy = false
        }
    }
}
