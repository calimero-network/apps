import ForumCore
import ForumGenerated
import MeroKit
import SwiftUI

/// A post opened from the timeline.
struct PostRoute: Hashable {
    let postId: String
}

/// One forum's timeline: Latest or Top, a compose button, and every post's actions.
struct FeedScreen: View {
    @StateObject private var model: FeedModel
    @State private var composing = false
    @State private var editing: PostView?
    @State private var confirmDelete: PostView?
    @State private var confirmRemove: PostView?
    @State private var showInfo = false
    /// Push a thread onto the navigation stack.
    let push: (PostRoute) -> Void

    init(backend: any MeroAppBackend, forum: ForumRef, names: any NameStore, push: @escaping (PostRoute) -> Void) {
        self.push = push
        _model = StateObject(wrappedValue: FeedModel(backend: backend, forum: forum, names: names))
    }

    var body: some View {
        List {
            Section {
                content
            } header: {
                SortTabs(sort: model.sort) { next in Task { await model.setSort(next) } }
                    .listRowInsets(EdgeInsets())
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(Palette.surface)
        .refreshable { await model.refresh() }
        .overlay(alignment: .top) {
            if let notice = model.notice { NoticeBanner(text: notice) { model.dismissNotice() } }
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                Haptics.tap()
                composing = true
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 58, height: 58)
                    .background(Circle().fill(Palette.lime))
                    .shadow(color: Palette.ink.opacity(0.18), radius: 10, y: 4)
            }
            .padding(20)
            .accessibilityLabel("New post")
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.surface, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(model.forum.forumName).font(Typeface.display(17)).foregroundStyle(Palette.ink).lineLimit(1)
                    Text(model.forum.spaceName).font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(1)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showInfo = true } label: { Image(systemName: "info.circle") }
                    .accessibilityLabel("About this forum")
            }
        }
        .navigationDestination(for: PostRoute.self) { route in
            PostScreen(feed: model, postId: route.postId)
        }
        .task { await model.start() }
        .task { await model.watch() }
        .sheet(isPresented: $composing) {
            ComposeSheet(heading: "New post", action: "Post", author: model.displayName, account: model.account) { title, body in
                try await model.createPost(title: title, body: body)
            }
        }
        .sheet(item: $editing) { post in
            ComposeSheet(
                heading: "Edit post", action: "Save", author: model.displayName, account: model.account,
                initialTitle: post.title, initialBody: post.body
            ) { title, body in
                try await model.editPost(post, title: title, body: body)
            }
        }
        .sheet(isPresented: $showInfo) { ForumInfoSheet(model: model) }
        .confirmationDialog("Delete this post?", isPresented: binding($confirmDelete), titleVisibility: .visible, presenting: confirmDelete) { post in
            Button("Delete", role: .destructive) { Task { await model.delete(post) } }
        } message: { _ in
            Text("Its replies go with it.")
        }
        .confirmationDialog("Remove this post?", isPresented: binding($confirmRemove), titleVisibility: .visible, presenting: confirmRemove) { post in
            Button("Remove", role: .destructive) { Task { await model.moderate(post) } }
        } message: { _ in
            Text("As a moderator you can remove anyone's post. It's removed for everyone.")
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ForEach(0..<4, id: \.self) { _ in
                SkeletonPost().listRowInsets(EdgeInsets()).listRowSeparatorTint(Palette.hairline)
            }
        case .failed(let message):
            ErrorState(message: message) { Task { await model.refresh() } }
                .listRowSeparator(.hidden)
        case .loaded where model.posts.isEmpty:
            EmptyState(
                symbol: "bubble.left.and.bubble.right", title: "No discussions yet",
                message: "Start the first discussion.", action: ("New post", { composing = true }))
                .listRowSeparator(.hidden)
        case .loaded:
            ForEach(model.posts, id: \.id) { post in
                row(post)
            }
            if model.hasMore {
                HStack { Spacer(); ProgressView().tint(Palette.muted); Spacer() }
                    .padding(.vertical, 18)
                    .listRowSeparator(.hidden)
                    .onAppear { Task { await model.loadMore() } }
            } else {
                Color.clear.frame(height: 90).listRowSeparator(.hidden)
            }
        }
    }

    private func row(_ post: PostView) -> some View {
        let mine = model.isMine(post)
        return PostRow(
            post: post, isMine: mine, isModerator: model.isModerator,
            vote: { value in Task { await model.vote(post, value: value) } },
            reply: { open(post) },
            edit: { editing = post },
            delete: { confirmDelete = post },
            moderate: { confirmRemove = post }
        )
        .background(NavigationLink(value: PostRoute(postId: post.id)) { EmptyView() }.opacity(0))
        .listRowInsets(EdgeInsets())
        .listRowSeparatorTint(Palette.hairline)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if mine {
                Button(role: .destructive) { confirmDelete = post } label: { Label("Delete", systemImage: "trash") }
                Button { editing = post } label: { Label("Edit", systemImage: "pencil") }.tint(Palette.inkSoft)
            } else if model.isModerator {
                Button(role: .destructive) { confirmRemove = post } label: { Label("Remove", systemImage: "xmark.shield") }
            }
        }
    }

    private func open(_ post: PostView) {
        // The reply button opens the thread, where the reply box is.
        push(PostRoute(postId: post.id))
    }

    private func binding<T>(_ value: Binding<T?>) -> Binding<Bool> {
        Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
    }
}

extension PostView: Identifiable {}
extension CommentView: Identifiable {}

/// Latest / Top, as a timeline's tabs: the selected one bold with a lime bar.
struct SortTabs: View {
    let sort: FeedSort
    let select: (FeedSort) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(FeedSort.allCases, id: \.self) { option in
                Button {
                    Haptics.tap()
                    select(option)
                } label: {
                    VStack(spacing: 10) {
                        Text(option.label)
                            .font(.system(size: 15, weight: option == sort ? .bold : .medium))
                            .foregroundStyle(option == sort ? Palette.ink : Palette.muted)
                        Capsule().fill(option == sort ? Palette.lime : .clear).frame(width: 56, height: 4)
                    }
                    .padding(.top, 12)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == sort ? .isSelected : [])
            }
        }
        .background(Palette.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }
}

struct SkeletonPost: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(Palette.sunken).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 160, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(height: 14)
                RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 220, height: 12)
            }
        }
        .padding(16)
    }
}

/// About this forum: your name here, its moderators, inviting people, and its ids.
struct ForumInfoSheet: View {
    @ObservedObject var model: FeedModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var savingName = false
    @State private var nameError: String?
    @State private var newModerator = ""
    @State private var moderatorError: String?
    @State private var inviting = false
    @State private var removing: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(label: model.forum.forumName, seed: model.forum.forumId, size: 52, square: true, symbol: "number")
                        VStack(alignment: .leading, spacing: 3) {
                            Text(model.forum.forumName).font(Typeface.display(20)).foregroundStyle(Palette.ink)
                            Text("in \(model.forum.spaceName)").font(.system(size: 14)).foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(.vertical, 4)
                    Text("\(model.forum.forumName) lives on the members' own nodes. Posts replicate peer to peer, with no server in between.")
                        .font(.system(size: 15)).foregroundStyle(Palette.inkSoft)
                    Button { inviting = true } label: {
                        Label("Invite people to this forum", systemImage: "person.badge.plus")
                    }
                }

                Section {
                    HStack {
                        TextField("Pick a name", text: $name)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .onSubmit(saveName)
                        if savingName {
                            ProgressView()
                        } else if name.trimmingCharacters(in: .whitespaces) != model.displayName {
                            Button("Save", action: saveName).buttonStyle(PrimaryButtonStyle(compact: true))
                        }
                    }
                    if let nameError { Text(nameError).font(.system(size: 14)).foregroundStyle(Palette.danger) }
                } header: {
                    Text("Your name")
                } footer: {
                    Text("Shown on your posts and replies here. Names aren't unique, so your account id is always shown beside it.")
                }

                Section {
                    ForEach(model.moderators, id: \.self) { account in
                        HStack(spacing: 12) {
                            Avatar(label: ForumFormat.shortAccount(account), seed: account, size: 32)
                            Text(ForumFormat.shortAccount(account)).font(.system(size: 15, design: .monospaced))
                            if account.caseInsensitiveCompare(model.account) == .orderedSame { Badge(text: "You") }
                            Spacer()
                            if model.isModerator && model.moderators.count > 1 {
                                Button {
                                    removing = account
                                } label: {
                                    Image(systemName: "xmark.shield").foregroundStyle(Palette.danger)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Remove moderator")
                            }
                        }
                    }
                    if model.isModerator {
                        HStack {
                            TextField("Account id to add", text: $newModerator)
                                .font(.system(size: 15, design: .monospaced))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                            Button("Add") {
                                Task {
                                    await change { try await model.addModerator(newModerator) }
                                    if moderatorError == nil { newModerator = "" }
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(newModerator.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    if let moderatorError {
                        Text(moderatorError).font(.system(size: 14)).foregroundStyle(Palette.danger)
                    }
                } header: {
                    Text("Moderators")
                } footer: {
                    Text(
                        model.isModerator
                            ? "You're a moderator. Moderators can remove anyone's posts and replies, and choose who else moderates."
                            : "Moderators can remove anyone's posts and replies.")
                }

                Section {
                    DetailsDisclosure(rows: [
                        ("Context ID", model.forum.contextId),
                        ("Forum ID", model.forum.forumId),
                        ("Space ID", model.forum.namespaceId),
                        ("Your account", model.account),
                    ])
                }
            }
            .forumNavigation("About this forum")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await model.loadModerators() }
            .onAppear { name = model.displayName }
            .confirmationDialog(
                "Remove this moderator?",
                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                titleVisibility: .visible, presenting: removing
            ) { account in
                Button("Remove", role: .destructive) { Task { await change { try await model.removeModerator(account) } } }
            } message: { _ in
                Text("They will no longer be able to remove posts and replies.")
            }
            .sheet(isPresented: $inviting) {
                InviteSheet(
                    title: "Invite people to \(model.forum.forumName)",
                    subtitle: "The link joins \(model.forum.spaceName) and opens \(model.forum.forumName) straight away."
                ) {
                    try await ForumsModel.forumInvite(backend: model.backend, ref: model.forum)
                }
            }
        }
    }

    private func saveName() {
        savingName = true
        nameError = nil
        Task {
            do {
                try await model.rename(name)
                Haptics.success()
            } catch {
                nameError = ForumErrorText.describe(error)
            }
            savingName = false
        }
    }

    private func change(_ run: () async throws -> Void) async {
        moderatorError = nil
        do {
            try await run()
            Haptics.success()
        } catch {
            moderatorError = ForumErrorText.describe(error)
            Haptics.failure()
        }
    }
}
