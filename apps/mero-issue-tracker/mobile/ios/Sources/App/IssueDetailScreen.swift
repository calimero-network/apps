import IssueTrackerCore
import SwiftUI
import UIKit

/// One issue: header, properties, the four sections, the fix prompt, the
/// activity thread, and a composer pinned above the keyboard.
struct IssueDetailScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    @StateObject private var model: IssueDetailModel
    let route: IssueRoute
    let onChange: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var comment = ""
    @State private var editingSections = false
    @State private var editingAssignee = false
    @State private var assigneeDraft = ""
    @State private var addingLabel = false
    @State private var labelDraft = ""
    @State private var editingComment: CommentView?
    @State private var commentDraft = ""
    @State private var confirmDelete = false
    @State private var copied = false
    @FocusState private var composerFocused: Bool

    init(workspace: WorkspaceModel, route: IssueRoute, seed: IssueView?, onChange: @escaping () async -> Void) {
        self.workspace = workspace
        self.route = route
        self.onChange = onChange
        _model = StateObject(
            wrappedValue: IssueDetailModel(
                client: workspace.client(for: route.repoId), issueId: route.issueId, account: workspace.account,
                seed: seed))
    }

    var body: some View {
        Group {
            if let issue = model.issue, !model.isGone {
                content(issue)
            } else if case .failed(let text) = model.phase {
                EmptyState(icon: "questionmark.circle", title: "Issue not available", message: text)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle(model.issue.map { TrackerFormat.shortIssueId($0.id) } ?? "Issue")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task {
            await model.load()
            await LiveUpdates.follow(backend: workspace.backend, contextId: route.repoId) { await model.load() }
        }
        .onChange(of: model.isGone) { gone in if gone { dismiss() } }
        .sheet(isPresented: $editingSections) {
            if let issue = model.issue {
                EditSectionsSheet(issue: issue) { draft in
                    let ok = await model.saveSections(draft)
                    if ok { await onChange() }
                    return ok ? nil : model.notice
                }
            }
        }
        .alert("Assignee", isPresented: $editingAssignee) {
            TextField("Unassigned", text: $assigneeDraft).textInputAutocapitalization(.words)
            Button("Save") { run { await model.setAssignee(assigneeDraft) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Who is on it. Leave empty to unassign.")
        }
        .alert("Add label", isPresented: $addingLabel) {
            TextField("Label name", text: $labelDraft).textInputAutocapitalization(.never)
            Button("Add") { run { await model.addLabel(labelDraft) } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Edit comment", isPresented: Binding(get: { editingComment != nil }, set: { if !$0 { editingComment = nil } })) {
            TextField("Comment", text: $commentDraft)
            Button("Save") {
                if let c = editingComment { run { await model.editComment(c.id, body: commentDraft) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete issue", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if await model.delete() {
                        Theme.success()
                        await onChange()
                    }
                }
            }
        } message: {
            Text("Delete \"\(model.issue?.title ?? "")\"? This also removes its comments and cannot be undone.")
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if model.issue != nil {
                Menu {
                    Button { editingSections = true } label: { Label("Edit sections", systemImage: "pencil") }
                    Button { copyPrompt() } label: { Label("Copy fix prompt", systemImage: "doc.on.doc") }
                    if model.isCreator {
                        Divider()
                        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete issue", systemImage: "trash") }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Theme.ink)
                }
                .accessibilityLabel("More")
            }
        }
    }

    private func content(_ issue: IssueView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let notice = model.notice {
                    NoticeBanner(text: notice) { model.notice = nil }.padding(.horizontal, -Theme.gutter)
                }
                header(issue)
                properties(issue)
                sections(issue)
                agentCard
                activity(issue)
                DetailsDisclosure(rows: [
                    ("Issue id", issue.id), ("Created by", issue.createdBy), ("Repository context", route.repoId),
                ])
                .card()
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.load() }
        .safeAreaInset(edge: .bottom) { composer }
    }

    private func header(_ issue: IssueView) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Pill(text: TrackerFormat.shortIssueId(issue.id), mono: true)
                HStack(spacing: 6) {
                    StatusDot(status: issue.status, size: 8)
                    Text(issue.status).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Theme.status(issue.status).opacity(0.14), in: Capsule())
                HStack(spacing: 6) {
                    PriorityGlyph(priority: issue.priority, size: 13)
                    Text(issue.priority.capitalized).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text2)
                }
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Theme.sunken, in: Capsule())
            }
            Text(issue.title).font(Theme.heading(22)).foregroundStyle(Theme.ink).textSelection(.enabled)
            HStack(spacing: 8) {
                Avatar(seed: issue.createdBy, size: 22)
                (Text(person(issue.createdBy)).fontWeight(.semibold).foregroundColor(Theme.ink)
                    + Text(" opened this \(TrackerFormat.ago(issue.createdAt))").foregroundColor(Theme.text2))
                    .font(.system(size: 13))
            }
        }
        .card(padding: 18)
    }

    private func properties(_ issue: IssueView) -> some View {
        VStack(spacing: 0) {
            propertyRow("Status") {
                Menu {
                    ForEach(Tracker.statuses, id: \.self) { s in
                        Button { Theme.haptic(); run { await model.setStatus(s) } } label: {
                            Label(s, systemImage: s == issue.status ? "checkmark" : StatusIcon.name(s))
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        StatusDot(status: issue.status)
                        Text(issue.status)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)).foregroundStyle(Theme.text3)
                    }
                }
            }
            Divider()
            propertyRow("Priority") {
                Menu {
                    ForEach(Tracker.priorities, id: \.self) { p in
                        Button { Theme.haptic(); run { await model.setPriority(p) } } label: {
                            if p == issue.priority { Label(p.capitalized, systemImage: "checkmark") } else { Text(p.capitalized) }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        PriorityGlyph(priority: issue.priority, size: 13)
                        Text(issue.priority.capitalized)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)).foregroundStyle(Theme.text3)
                    }
                }
            }
            Divider()
            propertyRow("Assignee") {
                Button {
                    assigneeDraft = issue.assignee ?? ""
                    editingAssignee = true
                } label: {
                    HStack(spacing: 6) {
                        if let who = issue.assignee, !who.isEmpty {
                            Avatar(seed: who, size: 20)
                            Text(who).lineLimit(1)
                        } else {
                            Image(systemName: "person.crop.circle").foregroundStyle(Theme.text3)
                            Text("Unassigned").foregroundStyle(Theme.text3)
                        }
                    }
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("Labels").font(.system(size: 14)).foregroundStyle(Theme.text2)
                FlowLayout(spacing: 6) {
                    ForEach(issue.labels, id: \.self) { label in
                        LabelChip(label: label) { run { await model.removeLabel(label) } }
                    }
                    Button {
                        labelDraft = ""
                        addingLabel = true
                    } label: {
                        Label("Add", systemImage: "tag").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .overlay(Capsule().stroke(Theme.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3])))
                    }
                    .accessibilityLabel("Add label")
                }
            }
            .padding(.vertical, 12)
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(Theme.ink)
        .card(padding: 14)
    }

    private func propertyRow<V: View>(_ name: String, @ViewBuilder value: () -> V) -> some View {
        HStack {
            Text(name).font(.system(size: 14)).foregroundStyle(Theme.text2)
            Spacer()
            value()
        }
        .frame(minHeight: 44)
    }

    private func sections(_ issue: IssueView) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            section(1, "Summary", issue.summary)
            Divider()
            section(2, "Impact", issue.impact)
            Divider()
            section(3, "Repro", issue.repro, mono: true)
            Divider()
            section(4, "Resolution criteria", issue.resolutionCriteria)
        }
        .card(padding: 16)
    }

    private func section(_ n: Int, _ title: String, _ text: String, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("\(n)").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink)
                    .frame(width: 20, height: 20).background(Theme.lime, in: Circle())
                Text(title.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.5).foregroundStyle(Theme.text3)
            }
            if mono {
                Text(text).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(Theme.sunken, in: RoundedRectangle(cornerRadius: 10))
                    .textSelection(.enabled)
            } else {
                Text(text).font(.system(size: 15)).foregroundStyle(Theme.ink).textSelection(.enabled)
            }
        }
        .padding(.vertical, 14)
    }

    private var agentCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Local agent", systemImage: "sparkles").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.text2)
            Text("A ready-to-paste prompt with all four sections, for a coding agent to fix this.")
                .font(.system(size: 14)).foregroundStyle(Theme.ink)
            Button { copyPrompt() } label: {
                Label(copied ? "Prompt copied" : "Copy fix prompt", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(PrimaryButtonStyle())
        }
        .card()
    }

    private func activity(_ issue: IssueView) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text("Activity").font(Theme.heading(16)).foregroundStyle(Theme.ink)
                Pill(text: "\(model.comments.count + 1)")
            }
            HStack(alignment: .top, spacing: 10) {
                Avatar(seed: issue.createdBy, size: 26)
                (Text(person(issue.createdBy)).fontWeight(.semibold).foregroundColor(Theme.ink)
                    + Text(" created this issue · \(TrackerFormat.ago(issue.createdAt))").foregroundColor(Theme.text3))
                    .font(.system(size: 13))
                    .padding(.top, 4)
            }
            ForEach(model.comments, id: \.id) { c in
                commentView(c)
            }
        }
        .card()
    }

    private func commentView(_ c: CommentView) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Avatar(seed: c.author, size: 26)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text(person(c.author)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text("· \(TrackerFormat.ago(c.createdAt))").font(.system(size: 13)).foregroundStyle(Theme.text3)
                    Spacer()
                    if model.isMine(c) {
                        Menu {
                            Button { commentDraft = c.body; editingComment = c } label: { Label("Edit", systemImage: "pencil") }
                            Button(role: .destructive) { run { await model.deleteComment(c.id) } } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis").foregroundStyle(Theme.text3).frame(width: 30, height: 22)
                        }
                        .accessibilityLabel("Comment actions")
                    }
                }
                (Text(c.body) + Text(c.editedAt != nil ? "  (edited)" : "").font(.system(size: 12)).foregroundColor(Theme.text3))
                    .font(.system(size: 14)).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.sunken, in: UnevenCorners())
                    .textSelection(.enabled)
            }
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Leave a comment…", text: $comment, axis: .vertical)
                .lineLimit(1...5)
                .focused($composerFocused)
                .accessibilityIdentifier("detail.commentField")
                .font(.system(size: 15))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.line, lineWidth: 1))
            Button {
                let body = comment
                Theme.haptic()
                Task {
                    if await model.addComment(body) {
                        comment = ""
                        composerFocused = false
                    }
                }
            } label: {
                Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                    .frame(width: 40, height: 40)
                    .background(Theme.lime.opacity(canSend ? 1 : 0.4), in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Comment")
            .accessibilityIdentifier("detail.send")
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var canSend: Bool { !comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isWorking }

    private func person(_ account: String) -> String {
        account.lowercased() == workspace.account.lowercased() ? "You" : TrackerFormat.truncateKey(account)
    }

    private func copyPrompt() {
        guard let prompt = model.fixPrompt(repoURL: workspace.activeRepo?.url) else { return }
        UIPasteboard.general.string = prompt
        Theme.success()
        copied = true
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            copied = false
        }
    }

    private func run(_ work: @escaping () async -> Void) {
        Task {
            await work()
            await onChange()
        }
    }
}

/// A speech-bubble corner: square at the top left, round elsewhere.
struct UnevenCorners: Shape {
    func path(in rect: CGRect) -> Path {
        let r: CGFloat = 14
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + r), radius: r)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - r, y: rect.maxY), radius: r)
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - r), radius: r)
        p.closeSubpath()
        return p
    }
}

/// Wraps chips onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
