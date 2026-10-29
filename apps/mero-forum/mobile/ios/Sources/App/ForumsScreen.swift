import ForumCore
import MeroKit
import SwiftUI

/// The forums in one space. Open one to read it; open ones you are not in yet
/// are joined on the way in.
struct ForumsScreen: View {
    @StateObject private var model: ForumsModel
    let space: AppNamespace
    /// Push a forum onto the navigation stack.
    let push: (ForumRef) -> Void
    @State private var showNew = false
    @State private var invite: InviteRequest?
    @State private var notice: String?

    init(backend: any MeroAppBackend, space: AppNamespace, applicationId: String, push: @escaping (ForumRef) -> Void) {
        self.space = space
        self.push = push
        _model = StateObject(
            wrappedValue: ForumsModel(
                backend: backend, namespaceId: space.id, spaceName: SpacesModel.name(of: space),
                applicationId: applicationId))
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if let notice { NoticeBanner(text: notice) { self.notice = nil }.padding(.horizontal, -16) }
                header
                switch model.phase {
                case .loading:
                    ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.load() } }
                case .loaded where model.forums.isEmpty:
                    EmptyState(
                        symbol: "number", title: "No forums yet", message: "Start the first forum in this space.",
                        action: ("New forum", { showNew = true }))
                case .loaded:
                    ForEach(Array(model.forums.enumerated()), id: \.element.id) { index, forum in
                        Button { open(forum) } label: {
                            ForumCard(forum: forum, entering: model.entering == forum.id)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("forums.card.\(index)")
                        .contextMenu {
                            Button { invite = .forum(forum) } label: { Label("Invite to this forum", systemImage: "person.badge.plus") }
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Palette.ground)
        .refreshable { await model.load() }
        .task { await model.load() }
        .forumNavigation(model.spaceName)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button { invite = .space } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Invite people")
                Button { showNew = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New forum")
            }
        }
        .sheet(isPresented: $showNew) {
            NameSheet(
                title: "New forum", placeholder: "Forum name", action: "Create",
                note: "Everyone in \(model.spaceName) can join it."
            ) { name in
                let ref = try await model.create(name: name)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { push(ref) }
            }
        }
        .sheet(item: $invite) { request in
            InviteSheet(
                title: request.title(space: model.spaceName),
                subtitle: request.subtitle(space: model.spaceName)
            ) {
                switch request {
                case .space: return try await model.spaceInvite()
                case .forum(let forum): return try await model.forumInvite(forum)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Avatar(label: model.spaceName, seed: space.id, size: 52, square: true)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.spaceName).font(Typeface.display(22)).foregroundStyle(Palette.ink).lineLimit(2)
                Text("Space · \(ForumFormat.count(model.forums.count, "forum", "forums"))")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func open(_ forum: ForumRow) {
        Haptics.tap()
        Task {
            do {
                push(try await model.enter(forum))
            } catch {
                notice = ForumErrorText.describe(error)
                Haptics.failure()
            }
        }
    }
}

enum InviteRequest: Identifiable {
    case space
    case forum(ForumRow)

    var id: String {
        switch self {
        case .space: return "space"
        case .forum(let forum): return forum.id
        }
    }

    func title(space: String) -> String {
        switch self {
        case .space: return "Invite people to \(space)"
        case .forum(let forum): return "Invite people to \(forum.name)"
        }
    }

    func subtitle(space: String) -> String {
        switch self {
        case .space: return "Anyone with this link can join \(space) and every forum in it."
        case .forum(let forum): return "The link joins \(space) and opens \(forum.name) straight away."
        }
    }
}

struct ForumCard: View {
    let forum: ForumRow
    let entering: Bool

    var body: some View {
        Card {
            HStack(spacing: 14) {
                Avatar(label: forum.name, seed: forum.id, size: 46, square: true, symbol: "number")
                VStack(alignment: .leading, spacing: 4) {
                    Text(forum.name).font(Typeface.display(18)).foregroundStyle(Palette.ink).lineLimit(1)
                    if forum.contextId == nil {
                        Text("Syncing…").font(.system(size: 14)).foregroundStyle(Palette.muted)
                    } else if forum.joined {
                        Badge(text: "Joined")
                    } else {
                        Text("Open · tap to join").font(.system(size: 14)).foregroundStyle(Palette.muted)
                    }
                }
                Spacer()
                if entering {
                    ProgressView().tint(Palette.ink)
                } else {
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
                }
            }
            .padding(14)
        }
        .contentShape(Rectangle())
    }
}

/// "Invitation ready": the link, to copy or share.
struct InviteSheet: View {
    let title: String
    let subtitle: String
    let mint: () async throws -> String
    @Environment(\.dismiss) private var dismiss
    @State private var link: String?
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "person.badge.plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 60, height: 60)
                .background(Circle().fill(Palette.lime))
                .padding(.top, 8)
            Text(title).font(Typeface.display(22)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
            Text(subtitle).font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            if let link {
                Text(link)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Palette.inkSoft)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
                Spacer(minLength: 0)
                ShareLink(item: link) {
                    Label("Share link", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(PrimaryButtonStyle())
                Button {
                    UIPasteboard.general.string = link
                    copied = true
                    Haptics.success()
                } label: {
                    Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(SecondaryButtonStyle())
            } else if let error {
                Text(error).font(.system(size: 15)).foregroundStyle(Palette.danger).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Try again") { Task { await run() } }.buttonStyle(PrimaryButtonStyle())
            } else {
                ProgressView("Creating link…").tint(Palette.ink)
                Spacer(minLength: 0)
            }
        }
        .padding(24)
        .background(Palette.surface)
        .presentationDetents([.medium])
        .task { await run() }
    }

    private func run() async {
        error = nil
        do {
            link = try await mint()
        } catch {
            self.error = ForumErrorText.describe(error)
        }
    }
}
