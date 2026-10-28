import IssueTrackerCore
import SwiftUI

/// The board: one column per status, swiped sideways one at a time. Cards move
/// with "Move to…" (no dragging).
struct BoardScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    let issues: IssuesModel?
    @Binding var sheet: TrackerSheet?
    @State private var path: [IssueRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            RepoGate(workspace: workspace, issues: issues, sheet: $sheet) { model in
                BoardView(model: model) { path.append(IssueRoute(repoId: model.repoId, issueId: $0)) }
            }
            .modifier(RepoToolbar(workspace: workspace, sheet: $sheet, canCreate: workspace.activeRepo != nil && issues != nil))
            .navigationDestination(for: IssueRoute.self) { route in
                IssueDetailScreen(workspace: workspace, route: route, seed: issues?.issues.first { $0.id == route.issueId }) {
                    await issues?.load()
                }
            }
        }
    }
}

struct BoardView: View {
    @ObservedObject var model: IssuesModel
    let open: (String) -> Void
    @State private var column = Tracker.statuses[0]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Tracker.statuses, id: \.self) { status in
                            Button {
                                withAnimation { column = status }
                            } label: {
                                HStack(spacing: 6) {
                                    StatusDot(status: status, size: 8)
                                    Text(status)
                                    Text("\(model.column(status).count)").foregroundStyle(Theme.text3).monospacedDigit()
                                }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(column == status ? Theme.lime : Theme.surface, in: Capsule())
                                .overlay(Capsule().stroke(column == status ? Color.clear : Theme.line, lineWidth: 1))
                            }
                            .id(status)
                            .accessibilityAddTraits(column == status ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 8)
                }
                .onChange(of: column) { value in withAnimation { proxy.scrollTo(value, anchor: .center) } }
            }
            if let notice = model.notice {
                NoticeBanner(text: notice) { model.notice = nil }.padding(.bottom, 6)
            }
            if case .failed(let text) = model.phase {
                EmptyState(icon: "wifi.exclamationmark", title: "Could not load issues", message: text,
                           action: ("Try again", { Task { await model.load() } }))
            } else if model.phase != .loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TabView(selection: $column) {
                    ForEach(Tracker.statuses, id: \.self) { status in
                        BoardColumn(model: model, status: status, open: open).tag(status)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
        }
        .background(Theme.ground)
        .searchable(text: $model.query, prompt: "Search issues")
    }
}

struct BoardColumn: View {
    @ObservedObject var model: IssuesModel
    let status: String
    let open: (String) -> Void

    var body: some View {
        let cards = model.column(status)
        ScrollView {
            LazyVStack(spacing: 10) {
                if cards.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: StatusIcon.name(status)).font(.system(size: 22)).foregroundStyle(Theme.text3)
                        Text("No issues").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.text3)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 48)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4])))
                }
                ForEach(cards, id: \.id) { issue in
                    BoardCard(model: model, issue: issue).onTapGesture { open(issue.id) }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 24)
        }
        .refreshable { await model.load() }
    }
}

struct BoardCard: View {
    @ObservedObject var model: IssuesModel
    let issue: IssueView

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                PriorityGlyph(priority: issue.priority)
                Pill(text: TrackerFormat.shortIssueId(issue.id), mono: true)
                Text(TrackerFormat.relativeTime(issue.createdAt)).font(.system(size: 12)).foregroundStyle(Theme.text3)
                Spacer()
                Menu {
                    MoveMenuItems(model: model, issue: issue)
                } label: {
                    Label("Move to…", systemImage: "arrow.right.circle")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 18))
                        .foregroundStyle(Theme.text2)
                        .frame(width: 36, height: 30)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Move to…")
            }
            Text(issue.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                .multilineTextAlignment(.leading).lineLimit(3)
            if !issue.labels.isEmpty || !(issue.assignee ?? "").isEmpty {
                HStack(spacing: 6) {
                    ForEach(issue.labels.prefix(2), id: \.self) { LabelChip(label: $0) }
                    Spacer()
                    if let who = issue.assignee, !who.isEmpty { Avatar(seed: who, size: 22) }
                }
            }
        }
        .card(padding: 14)
        .contentShape(Rectangle())
        .contextMenu { MoveMenuItems(model: model, issue: issue) }
    }
}
