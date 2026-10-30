import ForumCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Your spaces. A space holds forums and is what you invite people to.
struct SpacesScreen: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var model: SpacesModel
    @StateObject private var approvals: ApprovalsModel
    let openInvitation: (String) -> Void
    @State private var sheet: SpacesSheet?

    init(backend: any MeroAppBackend, session: MeroAppSession, openInvitation: @escaping (String) -> Void) {
        _model = StateObject(wrappedValue: SpacesModel(backend: backend))
        _approvals = StateObject(
            wrappedValue: ApprovalsModel(
                packageName: ForumConstants.packageName, appName: "Mero Forum",
                fetch: { [weak session] org in
                    guard let session else { throw CancellationError() }
                    return try await session.pendingApprovals(org: org)
                },
                consent: { [weak session] request in await session?.requestConsent(request) }))
        self.openInvitation = openInvitation
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if !model.hasRelay {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "antenna.radiowaves.left.and.right.slash")
                        Text("You're not connected to your cluster. Sign in again, or join a space from an invitation link.")
                            .font(.system(size: 14))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                }
                ApprovalsCard(model: approvals, orgs: model.spaces.map(\.id))
                switch model.phase {
                case .loading:
                    ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.load() } }
                case .loaded where model.spaces.isEmpty:
                    EmptyState(
                        symbol: "square.stack.3d.up",
                        title: "No spaces yet",
                        message: "Create a space for your community, or join one from an invitation link.",
                        action: ("New space", { sheet = .newSpace }))
                    Button("Join with a link") { sheet = .join }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                case .loaded:
                    ForEach(Array(model.spaces.enumerated()), id: \.element.id) { index, space in
                        NavigationLink(value: space) { SpaceCard(space: space) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("spaces.card.\(index)")
                    }
                }
            }
            .padding(16)
        }
        .background(Palette.ground)
        .refreshable {
            await model.load()
            await approvals.load(orgs: model.spaces.map(\.id))
        }
        .task {
            await model.load()
            if DemoMode.backend == nil { await approvals.load(orgs: model.spaces.map(\.id)) }
        }
        .forumNavigation("Spaces")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { sheet = .profile } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Account")
                .accessibilityIdentifier("spaces.account")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { sheet = .newSpace } label: { Label("New space", systemImage: "plus") }
                    Button { sheet = .join } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add a space")
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .newSpace:
                NameSheet(
                    title: "New space", placeholder: "Space name", action: "Create",
                    note: "A space holds forums. You can invite people to it once it exists."
                ) { name in
                    try await model.create(name: name)
                }
            case .join:
                JoinSheet { link in
                    sheet = nil
                    // After this sheet is down: the invitation sheet is presented from the root.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { openInvitation(link) }
                }
            case .profile:
                ProfileSheet()
            }
        }
    }
}

enum SpacesSheet: String, Identifiable {
    case newSpace, join, profile
    var id: String { rawValue }
}

struct SpaceCard: View {
    let space: AppNamespace

    var body: some View {
        Card {
            HStack(spacing: 14) {
                Avatar(label: SpacesModel.name(of: space), seed: space.id, size: 46, square: true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(SpacesModel.name(of: space))
                        .font(Typeface.display(18))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                    Text(space.memberCount > 0 ? ForumFormat.count(space.memberCount, "member", "members") : "Space")
                        .font(.system(size: 14))
                        .foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .padding(14)
        }
        .contentShape(Rectangle())
    }
}

struct SkeletonCard: View {
    var body: some View {
        Card {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 12).fill(Palette.sunken).frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 140, height: 14)
                    RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 80, height: 10)
                }
                Spacer()
            }
            .padding(14)
        }
        .redacted(reason: .placeholder)
    }
}

/// One name in, one async action out: new space, new forum.
struct NameSheet: View {
    let title: String
    let placeholder: String
    let action: String
    let note: String
    let submit: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: title, action: action, canAct: !name.trimmingCharacters(in: .whitespaces).isEmpty, busy: busy,
                cancel: { dismiss() }, act: run)
            VStack(alignment: .leading, spacing: 12) {
                TextField(placeholder, text: $name)
                    .font(Typeface.display(22))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(run)
                    .padding(.vertical, 8)
                Rectangle().fill(Palette.hairline).frame(height: 0.5)
                Text(note).font(.system(size: 14)).foregroundStyle(Palette.muted)
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private func run() {
        guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        error = nil
        Task {
            do {
                try await submit(name)
                Haptics.success()
                dismiss()
            } catch {
                self.error = ForumErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Paste an invitation link (or code) somebody sent you.
struct JoinSheet: View {
    let join: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Join with a link", action: "Continue", canAct: !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                busy: false, cancel: { dismiss() }, act: run)
            VStack(alignment: .leading, spacing: 12) {
                TextField("Paste an invitation link", text: $link, axis: .vertical)
                    .font(.system(size: 16))
                    .lineLimit(3...6)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
                if let clip = UIPasteboard.general.string, ForumInvitation.parse(clip) != nil, link.isEmpty {
                    Button {
                        link = clip
                    } label: {
                        Label("Paste from clipboard", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Text("Links look like links.calimero.network/com.calimero.mero-forum/join?invitation=…")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private func run() {
        guard ForumInvitation.parse(link) != nil else {
            error = "This isn't a Mero Forum invitation. Check the link and try again."
            Haptics.failure()
            return
        }
        join(link)
    }
}

/// Who you are, and the way out.
struct ProfileSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @Environment(\.dismiss) private var dismiss
    private let names = DefaultsNameStore()
    private var account: String? { DemoMode.backend?.account ?? session.account }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(label: names.name.isEmpty ? "You" : names.name, seed: account ?? "you", size: 52)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(names.name.isEmpty ? "No name yet" : names.name)
                                .font(Typeface.display(20)).foregroundStyle(Palette.ink)
                            Text(ForumFormat.handle(account ?? ""))
                                .font(.system(size: 14)).foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(.vertical, 6)
                } footer: {
                    Text("You set the name you post under inside each forum, from its info page.")
                }
                Section {
                    DetailsDisclosure(rows: [
                        ("Account", account ?? ""),
                        ("Application", DemoMode.applicationId ?? session.applicationId ?? ""),
                    ])
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            await session.signOut()
                            dismiss()
                        }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .forumNavigation("Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
