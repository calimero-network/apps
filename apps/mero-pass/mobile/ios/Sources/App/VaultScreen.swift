import MeroKit
import PassCore
import SwiftUI

/// Where a vault's screens go.
enum VaultRoute: Hashable {
    case item(String)
    case people
    case health
    case trash
    case activity
}

/// One vault. Reads the unlocked device key, then hands over to ``VaultContent``.
struct VaultScreen: View {
    let backend: any MeroAppBackend
    let ref: VaultRef
    let push: (VaultRoute) -> Void
    @EnvironmentObject private var keeper: DeviceKeeper
    @EnvironmentObject private var services: AppServices

    var body: some View {
        if let device = keeper.device {
            VaultContent(
                backend: backend, push: push,
                model: VaultModel(
                    ref: ref, backend: backend, device: device, label: services.deviceLabel,
                    preferences: services.preferences))
        }
    }
}

struct VaultContent: View {
    let backend: any MeroAppBackend
    let push: (VaultRoute) -> Void
    @StateObject private var model: VaultModel
    @EnvironmentObject private var services: AppServices
    @State private var adding: SecretKind?
    @State private var invite: (title: String, link: String, hint: String)?

    init(backend: any MeroAppBackend, push: @escaping (VaultRoute) -> Void, model: @autoclosure @escaping () -> VaultModel) {
        self.backend = backend
        self.push = push
        _model = StateObject(wrappedValue: model())
    }

    var body: some View {
        List {
            header
            banners
            if model.readable {
                if !model.live.isEmpty { filters }
                items
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .searchable(text: $model.query, prompt: "Search \(model.ref.vaultName)")
        .passNavigation(model.ref.vaultName)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button {
                        go(.people)
                    } label: {
                        Label("People and devices", systemImage: "person.2")
                    }
                    Button {
                        go(.health)
                    } label: {
                        Label(model.flagged > 0 ? "Password health (\(model.flagged))" : "Password health", systemImage: "heart.text.square")
                    }
                    Button {
                        go(.trash)
                    } label: {
                        Label(model.trashed.isEmpty ? "Trash" : "Trash (\(model.trashed.count))", systemImage: "trash")
                    }
                    Button {
                        go(.activity)
                    } label: {
                        Label("Activity", systemImage: "clock.arrow.circlepath")
                    }
                    Divider()
                    Button {
                        inviteSomeone()
                    } label: {
                        Label("Invite someone", systemImage: "person.badge.plus")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 20)).foregroundStyle(Palette.ink)
                }
                .accessibilityLabel("Vault menu")
                .disabled(model.state == nil)
                Button {
                    adding = newKind
                } label: {
                    Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.ink)
                }
                .accessibilityLabel("New item")
                .disabled(!model.canWrite)
            }
        }
        .navigationDestination(for: VaultRoute.self) { route in
            switch route {
            case .item(let id): ItemDetailScreen(model: model, secretId: id)
            case .people: PeopleScreen(vault: model)
            case .health: HealthScreen(model: model)
            case .trash: TrashScreen(model: model)
            case .activity: ActivityScreen(model: model)
            }
        }
        .refreshable { await model.reload() }
        .task { await model.run() }
        .sheet(item: $adding) { kind in
            ItemEditorSheet(model: model, editing: nil, initialKind: kind) { id in
                services.show("Saved, encrypted on this phone.")
                _ = id
            }
        }
        .sheet(isPresented: inviteShown) {
            if let invite {
                InviteLinkSheet(title: invite.title, link: invite.link, hint: invite.hint).presentationDetents([.medium, .large])
            }
        }
    }

    private func go(_ route: VaultRoute) { push(route) }

    private var newKind: SecretKind {
        if case .kind(let kind) = model.filter, let k = SecretKind(rawValue: kind) { return k }
        return .login
    }

    private var inviteShown: Binding<Bool> {
        Binding(get: { invite != nil }, set: { if !$0 { invite = nil } })
    }

    private func inviteSomeone() {
        Task {
            do {
                invite = (
                    "Invite to \(model.ref.vaultName)", try await model.invite(backend: backend),
                    "This link lands them in “\(model.ref.vaultName)”, but the access it grants is the whole of \(model.ref.teamName): every open vault in the team, including ones added later."
                )
            } catch {
                model.error = PassErrorText.describe(error)
            }
        }
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: 14) {
            Tile(name: model.ref.vaultName, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.ref.vaultName).font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text(model.subtitle).font(.system(size: 13)).foregroundStyle(Palette.muted)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 4, trailing: 20))
    }

    @ViewBuilder
    private var banners: some View {
        Group {
            if let error = model.error {
                Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) { model.error = nil }
            }
            switch model.phase {
            case .opening(let notice):
                HStack(spacing: 10) {
                    ProgressView().tint(Palette.ink)
                    Text(notice.map { "\($0) Trying again on its own." } ?? "Opening the vault…")
                        .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                }
                .padding(.vertical, 8)
            case .failed(let message):
                ErrorState(message: message) { Task { await model.retry() } }
            case .open(let state):
                stateBanner(state)
            }
            if let holders = model.holders, holders.browsers <= 1, holders.recovery == 0 {
                Banner(
                    tone: .warn, symbol: "exclamationmark.triangle.fill", title: "Only this phone can open this vault.",
                    text: "Lose it and the items are gone. Create a recovery key under Security, or open the vault on a second device.")
            }
            if model.state == .ready && !model.approvals.isEmpty {
                ApprovalsCard(model: model)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }

    @ViewBuilder
    private func stateBanner(_ state: SessionState) -> some View {
        switch state {
        case .ready:
            EmptyView()
        case .uninitialised:
            Banner(
                tone: .warn, symbol: "key", title: nil,
                text: "This vault has no key yet. It is created the first time its Admin opens it.")
        case .waiting:
            if model.role == .pending {
                Banner(
                    tone: .warn, symbol: "hourglass", title: "You are in, but not admitted yet.",
                    text: "A vault Admin lets you in the next time they open this vault. This screen updates by itself.")
            } else if model.awaitingApproval {
                VStack(alignment: .leading, spacing: 10) {
                    Banner(
                        tone: .warn, symbol: "iphone.and.arrow.forward", title: "Approve this phone.",
                        text: "On another device of yours that opens this vault, or from a vault Admin, approve the request showing this code. Lost every other device? Use your recovery key under Security.")
                    Text(model.myCode)
                        .font(.system(size: 30, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Palette.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surface))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
                        .accessibilityLabel("Approval code \(model.myCode)")
                }
            } else {
                Banner(
                    tone: .warn, symbol: "hourglass", title: "Waiting for the vault key.",
                    text: "It arrives as soon as a member who holds it opens the vault. Nothing to do here.")
            }
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(label: "All", count: model.live.count, selected: model.filter == .all) { model.filter = .all }
                ForEach(SecretKind.categoryOrder.filter { (model.counts[$0.rawValue] ?? 0) > 0 }) { kind in
                    Chip(
                        label: kind.plural, symbol: KindIcon.symbol(kind.rawValue), count: model.counts[kind.rawValue] ?? 0,
                        selected: model.filter == .kind(kind.rawValue)
                    ) { model.filter = .kind(kind.rawValue) }
                }
                ForEach(model.tags, id: \.self) { tag in
                    Chip(label: tag, symbol: "tag", count: nil, selected: model.filter == .tag(tag)) {
                        model.filter = .tag(tag)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
    }

    @ViewBuilder
    private var items: some View {
        let shown = model.shown
        if shown.isEmpty {
            Group {
                if !model.query.isEmpty {
                    EmptyState(symbol: "magnifyingglass", title: "Nothing matches", message: "Search looks at names, tags, usernames and sites, never at passwords.")
                } else if model.state == .waiting {
                    EmptyState(symbol: "lock", title: "Locked for now", message: "Items appear here once this phone has the vault key.")
                } else if model.live.isEmpty {
                    EmptyState(
                        symbol: "key", title: "This vault is empty",
                        message: "Everything you add is encrypted on this phone before it leaves.",
                        action: model.canWrite ? ("Add your first item", { adding = .login }) : nil)
                } else {
                    EmptyState(symbol: "tray", title: "Nothing here yet", message: "Nothing in this category.")
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
            ForEach(shown) { secret in
                NavigationLink(value: VaultRoute.item(secret.id)) {
                    ItemRow(secret: secret)
                }
                .listRowBackground(Palette.surface)
                .swipeActions(edge: .leading) {
                    if let copy = primaryCopy(secret) {
                        Button {
                            services.copySecret(copy.value, what: copy.label)
                        } label: {
                            Label("Copy \(copy.label.lowercased())", systemImage: "doc.on.doc")
                        }
                        .tint(Palette.ink)
                    }
                }
                .swipeActions(edge: .trailing) {
                    if model.canWrite {
                        Button(role: .destructive) {
                            Task { if await model.trash(secret.id) { services.show("Moved to trash.") } }
                        } label: {
                            Label("Trash", systemImage: "trash")
                        }
                    }
                }
            }
        }
    }

    /// What a leading swipe copies: the password, else the kind's first secret field.
    private func primaryCopy(_ s: Secret) -> (label: String, value: String)? {
        guard !s.unreadable, let kind = SecretKind(rawValue: s.kind) else { return nil }
        for f in kind.fields where f.secret && !f.totp {
            if let v = s.fields[f.key], !v.isEmpty { return (f.label, v) }
        }
        return nil
    }
}

struct Chip: View {
    let label: String
    var symbol: String?
    let count: Int?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)) }
                Text(label).font(.system(size: 14, weight: .medium))
                if let count, count > 0 {
                    Text("\(count)").font(.system(size: 12, weight: .semibold)).foregroundStyle(selected ? Palette.ink : Palette.muted)
                }
            }
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Capsule().fill(selected ? Palette.lime : Palette.surface))
            .overlay(Capsule().stroke(selected ? Color.clear : Palette.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

enum KindIcon {
    static func symbol(_ kind: String) -> String {
        switch SecretKind(rawValue: kind) {
        case .login: return "person.badge.key"
        case .secureNote: return "note.text"
        case .totp: return "clock.badge.checkmark"
        case .sshKey: return "terminal"
        case .paymentCard: return "creditcard"
        case .identity: return "person.text.rectangle"
        case .apiKey: return "key.horizontal"
        case .oauth2: return "link.badge.plus"
        case nil: return "key"
        }
    }
}

struct ItemRow: View {
    let secret: Secret

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Tile(name: secret.name, size: 40)
                Image(systemName: KindIcon.symbol(secret.kind))
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Palette.surface))
                    .overlay(Circle().stroke(Palette.hairline, lineWidth: 0.5))
                    .offset(x: 4, y: 4)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(secret.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                Text(secret.unreadable ? "Sealed under a key this phone never received" : ItemView.subtitle(secret))
                    .font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if secret.unreadable {
                Image(systemName: "lock.fill").font(.system(size: 13)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Devices asking for this vault, with Approve / Deny (the web's `DeviceApprovals`).
struct ApprovalsCard: View {
    @ObservedObject var model: VaultModel
    @State private var busy: String?

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text("Devices asking for this vault").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(
                    "Approve only a device you recognise, showing the same code. Approving gives it every key of this vault, old ones included."
                        + (model.approvals.contains { $0.kind == "agent" }
                            ? " An agent can then read every secret here: give one a vault that holds only what it should use." : "")
                )
                .font(.system(size: 13)).foregroundStyle(Palette.muted)
                ForEach(model.approvals) { request in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Image(systemName: request.kind == "agent" ? "cpu" : "iphone").foregroundStyle(Palette.ink)
                            Text(request.label.isEmpty ? (request.kind == "agent" ? "Agent" : "Device") : request.label)
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                            if request.kind == "agent" { Badge(text: "agent") }
                            Spacer()
                            Text(PassCrypto.confirmationCode(request.fingerprint))
                                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Palette.ink)
                        }
                        Text(
                            (request.account == model.me ? "your account" : "account \(ItemView.shortAccount(request.account))")
                                + " · registered \(ItemView.date(request.addedAt).formatted(date: .abbreviated, time: .shortened))"
                        )
                        .font(.system(size: 12)).foregroundStyle(Palette.muted)
                        HStack(spacing: 10) {
                            Button("Approve") { act(request) { await model.approve(request) } }
                                .buttonStyle(PrimaryButtonStyle(compact: true))
                            Button("Deny") { act(request) { await model.deny(request) } }
                                .buttonStyle(SecondaryButtonStyle(compact: true))
                            if busy == request.fingerprint { ProgressView().tint(Palette.ink) }
                        }
                        .disabled(busy != nil)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(14)
        }
    }

    private func act(_ request: DeviceRecord, _ body: @escaping () async -> Bool) {
        busy = request.fingerprint
        Task {
            if await body() { Haptics.success() } else { Haptics.failure() }
            busy = nil
        }
    }
}
