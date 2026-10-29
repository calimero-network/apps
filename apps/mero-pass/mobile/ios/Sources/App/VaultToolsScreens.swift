import PassCore
import SwiftUI

/// People and the devices holding the key (the web's `VaultPeople`).
struct PeopleScreen: View {
    @ObservedObject var vault: VaultModel
    @StateObject private var model: PeopleModel
    @EnvironmentObject private var services: AppServices
    @State private var confirmRemove: MemberRecord?
    @State private var confirmRevoke: DeviceRecord?
    @State private var confirmRotate = false

    init(vault: VaultModel) {
        self.vault = vault
        _model = StateObject(wrappedValue: PeopleModel(session: vault.session, api: vault.api))
    }

    var body: some View {
        List {
            Section {
                Text(
                    "The vault key is wrapped to each device below. Removing someone or revoking a device rotates the key, so nothing written afterwards is readable to them. What they already saw cannot be taken back: change those passwords."
                )
                .font(.system(size: 14)).foregroundStyle(Palette.muted)
                .listRowBackground(Color.clear)
                if let error = model.error {
                    Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) { model.error = nil }
                        .listRowBackground(Color.clear)
                }
                if let status = model.status {
                    Banner(tone: .info, symbol: "checkmark.shield", title: nil, text: status) { model.clearStatus() }
                        .listRowBackground(Color.clear)
                }
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))

            Section {
                ForEach(model.members) { member in
                    HStack(spacing: 12) {
                        Tile(name: member.account, size: 36, symbol: "person.fill")
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(ItemView.shortAccount(member.account) + (member.account == vault.me ? " (you)" : ""))
                                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                Badge(text: member.role.rawValue, strong: member.role == .admin)
                            }
                            Text("\(PeopleModel.roleHelp[member.role] ?? "") · \(member.devices) device\(member.devices == 1 ? "" : "s")")
                                .font(.system(size: 12)).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        if vault.isAdmin && member.account != vault.me {
                            Menu {
                                ForEach([Role.viewer, .editor, .admin], id: \.self) { role in
                                    Button {
                                        Task { await model.setRole(member.account, to: role) }
                                    } label: {
                                        if member.role == role {
                                            Label(role.rawValue.capitalized, systemImage: "checkmark")
                                        } else {
                                            Text(role.rawValue.capitalized)
                                        }
                                    }
                                }
                                if member.role != .removed {
                                    Divider()
                                    Button(role: .destructive) {
                                        confirmRemove = member
                                    } label: {
                                        Label("Remove from vault", systemImage: "person.badge.minus")
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle").font(.system(size: 20)).foregroundStyle(Palette.inkSoft)
                            }
                            .accessibilityLabel("Change role")
                        }
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                SectionLabel(text: "People")
            }

            Section {
                ForEach(model.devices) { device in
                    let mine = device.fingerprint == vault.session.fingerprint
                    HStack(spacing: 12) {
                        Image(systemName: deviceSymbol(device)).font(.system(size: 18)).foregroundStyle(Palette.ink)
                            .frame(width: 36, height: 36)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.sunken))
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text((device.label.isEmpty ? (device.kind == "agent" ? "Agent" : "Device") : device.label) + (mine ? " (this phone)" : ""))
                                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                if device.kind == "agent" { Badge(text: "agent") }
                                if device.revoked { Badge(text: "revoked") }
                            }
                            Text("\(device.fingerprint.prefix(16))… · \(device.account == vault.me ? "yours" : ItemView.shortAccount(device.account))")
                                .font(.system(size: 12, design: .monospaced)).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                    }
                    .swipeActions(edge: .trailing) {
                        if !device.revoked && (vault.isAdmin || device.account == vault.me) {
                            Button(role: .destructive) {
                                confirmRevoke = device
                            } label: {
                                Label("Revoke", systemImage: "xmark.shield")
                            }
                        }
                    }
                }
            } header: {
                SectionLabel(text: "Devices holding the key")
            } footer: {
                Text("Swipe a device to revoke it.").font(.system(size: 12)).foregroundStyle(Palette.muted)
            }

            if vault.isAdmin {
                Section {
                    Picker("Newcomers join as", selection: defaultRole) {
                        Text("Editor").tag(Role.editor)
                        Text("Viewer").tag(Role.viewer)
                    }
                    Button {
                        confirmRotate = true
                    } label: {
                        Label("Rotate vault key", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .foregroundStyle(Palette.ink)
                } header: {
                    SectionLabel(text: "Admin")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("People")
        .overlay {
            if model.phase == .loading && model.members.isEmpty { ProgressView().tint(Palette.ink) }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .disabled(model.status?.hasSuffix("…") == true)
        .confirmationDialog(
            "Remove \(confirmRemove.map { ItemView.shortAccount($0.account) } ?? "")?",
            isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove and rotate", role: .destructive) {
                if let member = confirmRemove { Task { if await model.remove(member.account) { await vault.reload() } } }
            }
        } message: {
            Text("The vault key is rotated so nothing written afterwards is readable to them.")
        }
        .confirmationDialog(
            "Revoke this device?",
            isPresented: Binding(get: { confirmRevoke != nil }, set: { if !$0 { confirmRevoke = nil } }),
            titleVisibility: .visible
        ) {
            Button("Revoke", role: .destructive) {
                if let device = confirmRevoke { Task { if await model.revoke(device) { await vault.reload() } } }
            }
        } message: {
            Text(vault.isAdmin ? "The vault key is rotated as well." : "It stops receiving this vault's keys.")
        }
        .confirmationDialog("Rotate the vault key?", isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("Rotate and re-encrypt") { Task { if await model.rotate() { await vault.reload() } } }
        } message: {
            Text("A new key is given to every device still entitled to it, and every item is re-encrypted under it.")
        }
    }

    private var defaultRole: Binding<Role> {
        Binding(
            get: { vault.info?.defaultRole == "viewer" ? .viewer : .editor },
            set: { role in Task { if await model.setDefaultRole(role) { await vault.reload() } } })
    }

    private func deviceSymbol(_ device: DeviceRecord) -> String {
        switch device.kind {
        case "recovery": return "doc.text"
        case "agent": return "cpu"
        default: return "iphone"
        }
    }
}

/// Weak, reused and old passwords (the web's `HealthPanel`).
struct HealthScreen: View {
    @ObservedObject var model: VaultModel

    var body: some View {
        let rows = PasswordTools.analyse(model.live)
        let flagged = rows.filter { !$0.issues.isEmpty }
        List {
            Section {
                Text("Checked on this phone, over the decrypted items. Nothing is sent anywhere.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    .listRowBackground(Color.clear)
            }
            if rows.isEmpty {
                EmptyState(symbol: "heart.text.square", title: "No passwords yet", message: "Logins with a password show up here.")
                    .listRowBackground(Color.clear)
            } else if flagged.isEmpty {
                EmptyState(
                    symbol: "checkmark.shield", title: "All \(rows.count) passwords look healthy",
                    message: "None is weak, reused or over a year old."
                )
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(flagged) { row in
                        NavigationLink(value: VaultRoute.item(row.id)) {
                            HStack(spacing: 12) {
                                Tile(name: row.name, size: 36)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(row.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                    HStack(spacing: 6) {
                                        ForEach(row.issues, id: \.self) { issue in Badge(text: issue.label) }
                                    }
                                }
                            }
                        }
                    }
                } header: {
                    SectionLabel(text: "\(flagged.count) of \(rows.count) need attention")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("Password health")
    }
}

/// Trashed items, restorable until an Admin deletes them for good.
struct TrashScreen: View {
    @ObservedObject var model: VaultModel
    @EnvironmentObject private var services: AppServices
    @State private var confirmPurge: Secret?

    var body: some View {
        List {
            if model.trashed.isEmpty {
                EmptyState(symbol: "trash", title: "The trash is empty", message: "Items stay recoverable here until an Admin deletes them for good.")
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(model.trashed) { secret in
                        HStack(spacing: 12) {
                            Image(systemName: KindIcon.symbol(secret.kind)).foregroundStyle(Palette.ink).frame(width: 28)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(secret.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                Text("Trashed \(ItemView.date(secret.trashedAt).formatted(date: .abbreviated, time: .shortened))")
                                    .font(.system(size: 12)).foregroundStyle(Palette.muted)
                            }
                        }
                        .swipeActions(edge: .leading) {
                            if model.canWrite {
                                Button {
                                    Task { if await model.restore(secret.id) { services.show("Restored.") } }
                                } label: {
                                    Label("Restore", systemImage: "arrow.uturn.backward")
                                }
                                .tint(Palette.ink)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            if model.isAdmin {
                                Button(role: .destructive) {
                                    confirmPurge = secret
                                } label: {
                                    Label("Delete forever", systemImage: "trash.slash")
                                }
                            }
                        }
                    }
                } footer: {
                    Text("Swipe right to restore\(model.isAdmin ? ", left to delete forever" : "").")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("Trash")
        .confirmationDialog(
            "Delete “\(confirmPurge?.name ?? "")” forever?",
            isPresented: Binding(get: { confirmPurge != nil }, set: { if !$0 { confirmPurge = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete forever", role: .destructive) {
                if let secret = confirmPurge { Task { await model.purge(secret.id) } }
            }
        } message: {
            Text("This cannot be undone.")
        }
    }
}

/// The vault's activity trail (the web's `ActivityList`).
struct ActivityScreen: View {
    @ObservedObject var model: VaultModel
    @State private var events: [AuditRecord] = []
    @State private var loaded = false

    var body: some View {
        List {
            if loaded && events.isEmpty {
                EmptyState(symbol: "clock", title: "Nothing yet", message: "Nothing has happened in this vault yet.")
                    .listRowBackground(Color.clear)
            }
            ForEach(Array(events.enumerated()), id: \.offset) { _, event in
                HStack(alignment: .top, spacing: 12) {
                    Circle().fill(Palette.lime).frame(width: 10, height: 10).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(event.redacted ? "entry redacted by its author" : event.action.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ":", with: " "))
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(model.secret(event.target)?.name ?? String(event.target.prefix(24)))
                            .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                        Text(
                            "\(ItemView.date(event.timestamp).formatted(date: .abbreviated, time: .shortened)) · \(ItemView.who(event.account, me: model.me)) · device \(event.device.prefix(8))"
                        )
                        .font(.system(size: 12)).foregroundStyle(Palette.muted)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("Activity")
        .overlay { if !loaded { ProgressView().tint(Palette.ink) } }
        .refreshable { events = await model.activity() }
        .task {
            events = await model.activity()
            loaded = true
        }
    }
}
