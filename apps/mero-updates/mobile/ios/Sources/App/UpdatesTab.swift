import SwiftUI
import UpdatesCore

/// A composer to present.
struct ComposerLaunch: Identifiable {
    let start: ComposerStart
    var id: String { "\(start)" }
}

/// The home tab. The team sees what is due, templates, drafts and the setup
/// checklist above the feed; an investor sees the feed, unread first.
struct UpdatesTab: View {
    @ObservedObject var audience: AudienceModel
    let openSettings: () -> Void
    /// A post to open once it is published.
    @Binding var openPost: String?
    @StateObject private var model: FeedModel
    @Environment(\.compose) private var composeAction
    @State private var path: [PostRoute] = []
    @State private var profile = false
    @State private var invite: InviteShare?

    init(audience: AudienceModel, openSettings: @escaping () -> Void, openPost: Binding<String?>) {
        self.audience = audience
        self.openSettings = openSettings
        _openPost = openPost
        _model = StateObject(wrappedValue: FeedModel(audience: audience))
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if audience.needsProfile { profilePrompt }
                    if let error = audience.error, !audience.hasLoaded { Card { ErrorLine(message: error) } }
                    PageHeader(
                        title: "Updates",
                        subtitle: audience.isTeam
                            ? "What you have sent this audience, and what is due next."
                            : "Everything \(audience.overview?.companyName.isEmpty == false ? audience.companyTitle : "the team") has shared with you, newest first."
                    )
                    if audience.isTeam {
                        Button { compose(.template("monthly")) } label: {
                            Label("New update", systemImage: "square.and.pencil")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        teamPanel
                        SectionLabel(title: "Published")
                    }
                    if !audience.categories.isEmpty { categoryFilter }
                    feed
                }
                .padding(16)
            }
            .screenBackground()
            .audienceToolbar(audience)
            .toolbar {
                if audience.isTeam {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { compose(.template("monthly")) } label: { Image(systemName: "square.and.pencil") }
                            .accessibilityLabel("New update")
                    }
                }
            }
            .refreshable {
                audience.bump()
                await audience.load()
            }
            .task(id: audience.version) { await model.load() }
            .navigationDestination(for: PostRoute.self) { PostScreen(postId: $0.id, audience: audience) }
            .onChange(of: openPost) { id in
                guard let id else { return }
                path = [PostRoute(id: id)]
                openPost = nil
            }
            .sheet(isPresented: $profile) { ProfileSheet(audience: audience) }
            .sheet(item: $invite) { InviteSheet(share: $0) }
        }
    }

    private func compose(_ start: ComposerStart) {
        Haptics.tap()
        composeAction(start)
    }

    // MARK: - Pieces

    private var profilePrompt: some View {
        Card {
            HStack(alignment: .top, spacing: 12) {
                IconTile(icon: "person.badge.plus", accent: true, size: 36)
                VStack(alignment: .leading, spacing: 4) {
                    Text(audience.isTeam ? "Tell your investors who you are." : "Tell the team who you are.")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                    Text(
                        audience.isTeam
                            ? "Your name goes on every update you publish."
                            : "The team sees who read, reacted and offered to help — as a name, not an account id."
                    )
                    .font(.footnote).foregroundStyle(Palette.ink2)
                }
            }
            Button { profile = true } label: { Text("Add your name") }
                .buttonStyle(PrimaryButtonStyle(compact: true))
        }
    }

    private var categoryFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(title: "All", selected: model.category == nil) { Task { await model.select(category: nil) } }
                ForEach(audience.categories) { category in
                    CategoryChip(
                        category: category, selected: model.category == category.id,
                        count: category.muted ? 0 : category.unreadCount
                    ) { Task { await model.select(category: category.id) } }
                }
            }
            .padding(.horizontal, 2)
        }
    }

    @ViewBuilder private var feed: some View {
        if let error = model.error { Card { ErrorLine(message: error) } }
        if !model.hasLoaded {
            SkeletonCard()
            SkeletonCard()
        } else if model.posts.isEmpty {
            Card {
                EmptyState(
                    icon: "doc.text",
                    title: model.category == nil ? "No updates yet." : "Nothing in this category yet.",
                    message: audience.isTeam
                        ? "Pick a template above — your investors see it the moment their node syncs."
                        : "When the team publishes, it shows up here. You can ask them something under Q&A in the meantime.")
            }
        } else {
            ForEach(model.posts) { post in
                NavigationLink(value: PostRoute(id: post.id)) {
                    UpdateRow(post: post, category: audience.category(post.categoryId))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - The team's panel

    @ViewBuilder private var teamPanel: some View {
        if let overview = audience.overview, overview.nextDueAt > 0 {
            let overdue = Format.isOverdue(overview.nextDueAt)
            HStack(spacing: 12) {
                IconTile(icon: "calendar", accent: !overdue, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.dueLabel(overview.nextDueAt)).font(.headline)
                        .foregroundStyle(overdue ? Palette.danger : Palette.ink)
                    Text("Every \(overview.cadenceDays) days · last sent \(Format.timeAgo(overview.lastUpdateAt))")
                        .font(.footnote).foregroundStyle(Palette.ink2)
                }
                Spacer()
            }
            .padding(14)
            .background(overdue ? Palette.dangerSoft : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
        }

        SectionLabel(title: "Start from a template")
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                if (audience.overview?.updatesTotal ?? 0) > 0 {
                    TemplateCard(
                        icon: "arrow.triangle.2.circlepath", accent: true, title: "Reuse the last one",
                        detail: "Same sections and KPIs, fresh numbers.") { compose(.reuseLatest) }
                }
                ForEach(UpdateTemplate.all.prefix(4)) { template in
                    TemplateCard(icon: "doc.text", title: template.name, detail: template.description) {
                        compose(.template(template.id))
                    }
                }
            }
            .padding(.horizontal, 2)
        }

        if !model.drafts.isEmpty {
            SectionLabel(title: "Drafts", trailing: "Private until you publish")
            Card(padding: 4) {
                ForEach(model.drafts) { draft in
                    HStack(spacing: 10) {
                        Badge(title: "Draft", tone: .muted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(draft.title.isEmpty ? "Untitled draft" : draft.title)
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                            Text("Edited \(Format.timeAgo(draft.updatedAt))").font(.caption).foregroundStyle(Palette.ink3)
                        }
                        Spacer()
                        Menu {
                            Button { compose(.draft(draft.id)) } label: { Label("Continue", systemImage: "square.and.pencil") }
                            Button(role: .destructive) { Task { await model.discard(draft) } } label: {
                                Label("Discard", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis").frame(width: 32, height: 32).foregroundStyle(Palette.ink2)
                        }
                        .accessibilityLabel("Draft actions")
                    }
                    .padding(10)
                    .contentShape(Rectangle())
                    .onTapGesture { compose(.draft(draft.id)) }
                }
            }
        }

        if !model.setupDone && model.hasLoaded {
            Card {
                HStack {
                    Text("Getting started").font(.headline).foregroundStyle(Palette.ink)
                    Spacer()
                    Text("\(model.setupSteps.filter(\.done).count) of \(model.setupSteps.count) done")
                        .font(.footnote).foregroundStyle(Palette.ink2)
                }
                ForEach(model.setupSteps) { step in
                    Button { run(step) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(step.done ? Palette.good : Palette.ink3)
                            Text(step.label).font(.subheadline)
                                .foregroundStyle(step.done ? Palette.ink2 : Palette.ink)
                                .strikethrough(step.done)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            if !step.done {
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Palette.ink3)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(step.done)
                }
            }
        }
    }

    private func run(_ step: FeedModel.SetupStep) {
        switch step.target {
        case .settings: openSettings()
        case .compose: compose(.template("monthly"))
        case .invite:
            Task {
                if let invitation = try? await audience.invitation() {
                    invite = InviteShare(
                        invitation: invitation,
                        hint: "Opening the link puts your investors straight into \(audience.audience.title). Anyone with the link joins as a reader.")
                }
            }
        }
    }
}

private struct TemplateCard: View {
    let icon: String
    var accent = false
    let title: String
    let detail: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                IconTile(icon: icon, accent: accent, size: 32)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                Text(detail).font(.caption).foregroundStyle(Palette.ink2).lineLimit(3)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .frame(width: 160, height: 136, alignment: .topLeading)
            .padding(12)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

/// One update in the feed.
struct UpdateRow: View {
    let post: PostCard
    let category: CategoryView?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Avatar(account: post.author, name: post.authorName, team: post.authorIsTeam, size: 24)
                Text(People.label(post.authorName, post.author)).font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.ink).lineLimit(1)
                Text("· \(Format.formatDate(post.createdAt))").font(.footnote).foregroundStyle(Palette.ink3)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if !post.readByMe { Badge(title: "New") }
            }
            if let category { CategoryChip(category: category) }
            Text(post.title).font(Typeface.display(20)).foregroundStyle(Palette.ink)
                .multilineTextAlignment(.leading)
            if !post.summary.isEmpty {
                Text(post.summary).font(.subheadline).foregroundStyle(Palette.ink2).lineLimit(3)
                    .multilineTextAlignment(.leading)
            }
            HStack(spacing: 14) {
                if post.metricCount > 0 { stat("chart.bar", post.metricCount, "KPIs") }
                if post.openAskCount > 0 { stat("hand.raised", post.openAskCount, "open asks") }
                if post.commentCount > 0 { stat("bubble.left", post.commentCount, "replies") }
                ForEach(post.reactions.filter { $0.count > 0 }.prefix(3)) { r in
                    Text("\(r.emoji) \(r.count)").font(.caption.weight(.medium)).foregroundStyle(Palette.ink2)
                }
                Spacer()
                HStack(spacing: 2) {
                    Text("Read update").font(.footnote.weight(.semibold))
                    Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                }
                .foregroundStyle(Palette.ink)
            }
        }
        .padding(16)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(post.readByMe ? Palette.hairline : Palette.ink.opacity(0.25), lineWidth: post.readByMe ? 0.5 : 1)
        )
        .contentShape(Rectangle())
    }

    private func stat(_ icon: String, _ n: UInt64, _ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.caption)
            Text("\(n)").font(.caption.weight(.medium))
        }
        .foregroundStyle(Palette.ink2)
        .accessibilityLabel("\(n) \(label)")
    }
}
