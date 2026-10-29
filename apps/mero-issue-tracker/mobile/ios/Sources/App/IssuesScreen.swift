import IssueTrackerCore
import SwiftUI

struct IssueRoute: Hashable {
    let repoId: String
    let issueId: String
}

enum StatusIcon {
    /// `In progress` → `in-progress`, for accessibility identifiers.
    static func slug(_ status: String) -> String { status.lowercased().replacingOccurrences(of: " ", with: "-") }

    static func name(_ status: String) -> String {
        switch status {
        case "In progress": return "circle.lefthalf.filled"
        case "Blocked": return "nosign"
        case "Done": return "checkmark.circle"
        default: return "circle"
        }
    }
}

/// The list: issues grouped by status, searchable, filtered by chips; swipe to
/// close or reopen, long-press to move.
struct IssuesScreen: View {
    @ObservedObject var workspace: WorkspaceModel
    let issues: IssuesModel?
    @Binding var sheet: TrackerSheet?
    @State private var path: [IssueRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            RepoGate(workspace: workspace, issues: issues, sheet: $sheet) { model in
                IssueList(model: model, sheet: $sheet) { path.append(IssueRoute(repoId: model.repoId, issueId: $0)) }
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

struct IssueList: View {
    @ObservedObject var model: IssuesModel
    @Binding var sheet: TrackerSheet?
    let open: (String) -> Void

    var body: some View {
        List {
            Section {
                FilterBar(model: model, sheet: $sheet)
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            .listRowBackground(Color.clear)

            content
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .searchable(text: $model.query, prompt: "Search issues")
        .refreshable { await model.load() }
        .overlay(alignment: .top) {
            if let notice = model.notice {
                NoticeBanner(text: notice) { model.notice = nil }.padding(.top, 8)
            }
        }
        .animation(.default, value: model.notice)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle, .loading:
            HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear).padding(.top, 40)
        case .failed(let text):
            EmptyState(icon: "wifi.exclamationmark", title: "Could not load issues", message: text,
                       action: ("Try again", { Task { await model.load() } }))
                .listRowBackground(Color.clear)
        case .loaded:
            if model.issues.isEmpty {
                EmptyState(
                    icon: "tray", title: "No issues yet",
                    message: "File the first one: what is broken, who it hurts, how to reproduce it, and what fixed means.",
                    action: ("New issue", { sheet = .newIssue })
                )
                .listRowBackground(Color.clear)
            } else if model.sections.isEmpty {
                let q = model.query.trimmingCharacters(in: .whitespaces)
                EmptyState(icon: "magnifyingglass", title: "Nothing here",
                           message: q.isEmpty ? "No issues match these filters." : "No issues match \"\(q)\".")
                    .listRowBackground(Color.clear)
            } else {
                let sections = model.sections
                ForEach(Array(sections.enumerated()), id: \.element.id) { s, section in
                    Section {
                        ForEach(Array(section.issues.enumerated()), id: \.element.id) { i, issue in
                            Button { open(issue.id) } label: { IssueRow(issue: issue) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("issues.row.\(sections.prefix(s).reduce(0) { $0 + $1.issues.count } + i)")
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) { closeAction(issue) }
                                .contextMenu { MoveMenuItems(model: model, issue: issue) }
                        }
                    } header: {
                        HStack(spacing: 8) {
                            StatusDot(status: section.status)
                            Text(section.status).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
                            Text("\(section.issues.count)")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.status(section.status))
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Theme.status(section.status).opacity(0.14), in: Capsule())
                        }
                        .textCase(nil)
                    }
                }
            }
        }
    }

    @ViewBuilder private func closeAction(_ issue: IssueView) -> some View {
        if issue.status == "Done" {
            Button {
                Theme.haptic()
                Task { await model.move(issue.id, to: "Open") }
            } label: { Label("Reopen", systemImage: "arrow.uturn.backward") }
                .tint(Theme.status("Open"))
        } else {
            Button {
                Theme.haptic()
                Task { await model.move(issue.id, to: "Done") }
            } label: { Label("Done", systemImage: "checkmark") }
                .tint(Theme.status("Done"))
        }
    }
}

/// "Move to…" as menu items: every other status.
struct MoveMenuItems: View {
    @ObservedObject var model: IssuesModel
    let issue: IssueView

    var body: some View {
        Section("Move to…") {
            ForEach(Tracker.statuses.filter { $0 != issue.status }, id: \.self) { status in
                Button {
                    Theme.haptic()
                    Task { await model.move(issue.id, to: status) }
                } label: { Label(status, systemImage: StatusIcon.name(status)) }
                    .accessibilityIdentifier("move.\(StatusIcon.slug(status))")
            }
        }
    }
}

struct IssueRow: View {
    let issue: IssueView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            PriorityGlyph(priority: issue.priority).padding(.top, 2)
            VStack(alignment: .leading, spacing: 7) {
                Text(issue.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(2)
                HStack(spacing: 6) {
                    Pill(text: TrackerFormat.shortIssueId(issue.id), mono: true)
                    ForEach(issue.labels.prefix(2), id: \.self) { LabelChip(label: $0) }
                    Spacer(minLength: 4)
                    if let who = issue.assignee, !who.isEmpty { Avatar(seed: who, size: 20) }
                    Text(TrackerFormat.relativeTime(issue.createdAt))
                        .font(.system(size: 12)).foregroundStyle(Theme.text3).monospacedDigit()
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Filters button, the active filters as removable chips, Clear, and the count.
struct FilterBar: View {
    @ObservedObject var model: IssuesModel
    @Binding var sheet: TrackerSheet?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button { sheet = .filters } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                        Text("Filters")
                        if model.filters.activeCount > 0 {
                            Text("\(model.filters.activeCount)").font(.system(size: 11, weight: .bold))
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Theme.lime, in: Capsule())
                        }
                    }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Theme.surface, in: Capsule())
                    .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                }
                .accessibilityIdentifier("issues.filters")
                chip("Status", \.status)
                chip("Priority", \.priority)
                chip("Assignee", \.assignee)
                chip("Label", \.label)
                if model.filters.isActive {
                    Button("Clear") { model.clearFilters() }
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
                        .accessibilityIdentifier("issues.clearFilters")
                }
                Text(model.visible.count == 1 ? "1 issue" : "\(model.visible.count) issues")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.text3).monospacedDigit()
                    .padding(.leading, 4)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder private func chip(_ name: String, _ key: WritableKeyPath<IssueFilters, String>) -> some View {
        let value = model.filters[keyPath: key]
        if !value.isEmpty {
            HStack(spacing: 4) {
                Text("\(name): \(name == "Priority" ? value.capitalized : value)")
                Button { model.filters[keyPath: key] = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                }
                .accessibilityLabel("Remove \(name) filter")
            }
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
            .padding(.leading, 12).padding(.trailing, 10).frame(height: 32)
            .background(Theme.lime.opacity(0.45), in: Capsule())
        }
    }
}
