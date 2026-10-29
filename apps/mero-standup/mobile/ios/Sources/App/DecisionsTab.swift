import StandupCore
import SwiftUI

/// The decision log: search, tag filter, standing only, list or timeline.
struct DecisionsTab: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var model: DecisionsModel
    let onCompose: (DecisionDraft) -> Void

    @State private var timeline = false
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Group {
                    filters
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if model.hasLoaded, model.items.isEmpty {
                        Card {
                            if model.isFiltered {
                                EmptyState(icon: "magnifyingglass", title: "No decision matches that.")
                            } else {
                                EmptyState(
                                    icon: "checkmark.seal", title: "No decisions yet.",
                                    message:
                                        "Log the first one. Six months from now, \u{201C}why did we do it this way?\u{201D} will have an answer.")
                            }
                        }
                    } else if !model.hasLoaded {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                    }
                    if timeline {
                        ForEach(model.months, id: \.title) { month in
                            TimelineMonth(team: team, title: month.title, items: month.items) { path.append($0) }
                        }
                    } else {
                        ForEach(Array(model.items.enumerated()), id: \.element.id) { index, decision in
                            DecisionCard(team: team, model: model, decision: decision, onTag: { tag in
                                Task { await model.toggle(tag: tag) }
                            }, onOpen: { path.append($0) })
                            .contentShape(Rectangle())
                            .onTapGesture { path.append(decision.id) }
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("decisions.card.\(index)")
                            .swipeActions(edge: .trailing) {
                                if decision.supersededBy.isEmpty {
                                    Button { onCompose(DecisionDraft(supersedes: decision)) } label: {
                                        Label("Supersede", systemImage: "arrow.triangle.2.circlepath")
                                    }
                                    .tint(Palette.ink)
                                }
                            }
                        }
                    }
                    if model.hasMore {
                        Button("Show older") { Task { await model.showOlder() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Decisions")
            .searchable(text: $model.search, prompt: "Search titles, decisions, reasons and tags")
            .task(id: model.search) {
                // Typing settles before the log is asked again.
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await model.refilter()
            }
            .refreshable { await model.load() }
            .onChange(of: team.version) { _ in Task { await model.load() } }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { onCompose(DecisionDraft()) } label: {
                        Image(systemName: "plus").accessibilityLabel("Log a decision")
                    }
                    .accessibilityIdentifier("decisions.compose")
                }
            }
            .navigationDestination(for: String.self) { id in
                DecisionDetail(team: team, model: model, id: id, onCompose: onCompose) { path.append($0) }
            }
        }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("View", selection: $timeline) {
                Text("List").tag(false)
                Text("Timeline").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("decisions.view")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(title: "Standing only", icon: model.standingOnly ? "checkmark" : nil, selected: model.standingOnly) {
                        model.standingOnly.toggle()
                        Task { await model.refilter() }
                    }
                    ForEach(model.tags, id: \.tag) { tag in
                        Chip(title: "#\(tag.tag) \(tag.count)", selected: model.tag == tag.tag) {
                            Task { await model.toggle(tag: tag.tag) }
                        }
                    }
                }
            }
        }
    }
}

private struct DecisionCard: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var model: DecisionsModel
    let decision: DecisionView
    let onTag: (String) -> Void
    let onOpen: (String) -> Void

    var body: some View {
        let replaced = !decision.supersededBy.isEmpty
        Card {
            HStack(alignment: .firstTextBaseline) {
                Text(decision.title).font(.headline).foregroundStyle(replaced ? Palette.ink2 : Palette.ink)
                Spacer()
                Badge(title: replaced ? "Superseded" : "Standing", muted: replaced)
            }
            RichTextView(text: decision.decision)
            if !decision.rationale.isEmpty { FieldBlock(label: "Why", text: decision.rationale) }
            DecisionNotes(team: team, decision: decision, onTag: onTag)
            Text(meta).font(.caption).foregroundStyle(Palette.ink2)
            if !decision.supersedes.isEmpty {
                LinkLine(
                    text: "Replaces \u{201C}\(model.title(of: decision.supersedes) ?? "an earlier decision")\u{201D}"
                ) { onOpen(decision.supersedes) }
            }
            if replaced {
                LinkLine(text: "Replaced by \u{201C}\(model.title(of: decision.supersededBy) ?? "a later decision")\u{201D}") {
                    onOpen(decision.supersededBy)
                }
            }
        }
        .opacity(replaced ? 0.85 : 1)
    }

    private var meta: String {
        var parts = [team.name(of: decision.author, decision.authorName), Days.relative(nanos: decision.createdAt)]
        if !decision.fromDay.isEmpty { parts.append("from the \(Days.describe(decision.fromDay).lowercased()) standup") }
        return parts.joined(separator: " · ")
    }
}

private struct LinkLine: View {
    let text: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label(text, systemImage: "arrow.triangle.2.circlepath").font(.footnote.weight(.medium)).foregroundStyle(Palette.ink)
        }
        .buttonStyle(.borderless)
    }
}

private struct DecisionNotes: View {
    @ObservedObject var team: TeamModel
    let decision: DecisionView
    let onTag: (String) -> Void

    var body: some View {
        if !decision.tags.isEmpty || !decision.with.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if !decision.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(decision.tags, id: \.self) { tag in Chip(title: "#\(tag)") { onTag(tag) } }
                        }
                    }
                }
                if !decision.with.isEmpty {
                    HStack(spacing: 6) {
                        Text("with").font(.caption).foregroundStyle(Palette.ink2)
                        ForEach(decision.with, id: \.account) { person in
                            HStack(spacing: 4) {
                                Avatar(account: person.account, name: person.name, size: 20)
                                Text(team.name(of: person.account, person.name)).font(.caption).foregroundStyle(Palette.ink)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct TimelineMonth: View {
    @ObservedObject var team: TeamModel
    let title: String
    let items: [DecisionView]
    let onOpen: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(title: title)
            ForEach(items, id: \.id) { decision in
                Button { onOpen(decision.id) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(spacing: 0) {
                            Circle().fill(decision.supersededBy.isEmpty ? Palette.lime : Palette.hairline)
                                .overlay(Circle().strokeBorder(Palette.ink, lineWidth: 1))
                                .frame(width: 12, height: 12).padding(.top, 4)
                            Rectangle().fill(Palette.hairline).frame(width: 1)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(decision.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                if !decision.supersededBy.isEmpty { Badge(title: "Superseded", muted: true) }
                            }
                            Text("\(Days.shortDate(nanos: decision.createdAt)) · \(team.name(of: decision.author, decision.authorName))")
                                .font(.caption).foregroundStyle(Palette.ink2)
                            Text(decision.decision).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(2)
                        }
                        .padding(.bottom, 14)
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
    }
}

/// One decision on its own, with Supersede and its details.
struct DecisionDetail: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var model: DecisionsModel
    let id: String
    let onCompose: (DecisionDraft) -> Void
    let onOpen: (String) -> Void
    @State private var decision: DecisionView?
    @State private var missing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let decision {
                    DecisionCard(team: team, model: model, decision: decision, onTag: { tag in
                        Task { await model.toggle(tag: tag) }
                    }, onOpen: onOpen)
                    if decision.supersededBy.isEmpty {
                        Button { onCompose(DecisionDraft(supersedes: decision)) } label: {
                            Label("Supersede", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    Text("Decisions can't be edited once logged. Supersede one to change course.")
                        .font(.footnote).foregroundStyle(Palette.ink3)
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 10) {
                            DetailRow(label: "Decision id", value: decision.id)
                            DetailRow(label: "Author", value: decision.author)
                        }
                        .padding(.top, 8)
                    } label: {
                        Label("Details", systemImage: "info.circle").font(.subheadline).foregroundStyle(Palette.ink2)
                    }
                    .tint(Palette.ink2)
                } else if missing {
                    Card { EmptyState(icon: "checkmark.seal", title: "This decision has not synced yet.") }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Decision")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(id)|\(team.version)") {
            decision = await model.decision(id)
            missing = decision == nil
        }
    }
}

/// Log a decision, or supersede one.
struct DecisionSheet: View {
    @ObservedObject var model: DecisionsModel
    let onLogged: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: DecisionDraft
    @State private var busy = false
    @State private var error: String?

    init(model: DecisionsModel, draft: DecisionDraft, onLogged: @escaping (String) -> Void) {
        self.model = model
        self.onLogged = onLogged
        _draft = State(initialValue: draft)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let old = draft.supersedes {
                        Text("Replacing \u{201C}\(old.title)\u{201D}. The original stays in the log, marked superseded.")
                            .font(.subheadline).foregroundStyle(Palette.ink2)
                    }
                    if let day = draft.fromDay {
                        HStack {
                            Label("From the \(Days.describe(day).lowercased()) standup", systemImage: "sun.max")
                                .font(.subheadline).foregroundStyle(Palette.ink)
                            Spacer()
                            Button("Remove") { draft.fromDay = nil }.font(.subheadline).foregroundStyle(Palette.ink2)
                        }
                        .padding(12)
                        .background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    LabelledEditor(label: "Title", placeholder: "Release every two weeks", text: $draft.title, limit: Limits.title, minLines: 1, identifier: "decision.title")
                    LabelledEditor(label: "Decision", placeholder: "What exactly was decided", text: $draft.decision, limit: Limits.body, identifier: "decision.body")
                    LabelledEditor(label: "Why", placeholder: "Context, options considered, why this one", text: $draft.rationale, limit: Limits.body, identifier: "decision.why")
                    VStack(alignment: .leading, spacing: 8) {
                        LabelledEditor(label: "Tags", placeholder: "infra, release process", text: $draft.tagsInput, limit: 400, minLines: 1, identifier: "decision.tags")
                            .textInputAutocapitalization(.never)
                        if !draft.tags.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) { ForEach(draft.tags, id: \.self) { Badge(title: "#\($0)", muted: true) } }
                            }
                        }
                        let unused = model.tags.map(\.tag).filter { !draft.tags.contains($0) }
                        if !unused.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(unused, id: \.self) { tag in
                                        Chip(title: "+ #\(tag)") {
                                            draft.tagsInput = (draft.tags + [tag]).joined(separator: ", ")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !model.team.members.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Decided with").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                            FlowChips(members: model.team.members, team: model.team, selected: $draft.with)
                        }
                    }
                    Text("Decisions can't be edited once logged. Supersede one to change course.")
                        .font(.footnote).foregroundStyle(Palette.ink3)
                    if let error { ErrorLine(message: error) }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(draft.supersedes == nil ? "Log a decision" : "Supersede a decision")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button(action: log) {
                    Text(busy ? "Logging…" : draft.supersedes == nil ? "Log decision" : "Log replacement")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || !draft.isReady)
                .accessibilityIdentifier("decision.log")
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy)
    }

    private func log() {
        guard !busy, draft.isReady else { return }
        busy = true
        Task {
            do {
                let id = try await model.log(draft)
                Haptics.success()
                onLogged(id)
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
                Haptics.error()
            }
            busy = false
        }
    }
}

/// The people a decision was made with, as toggles.
private struct FlowChips: View {
    let members: [MemberView]
    @ObservedObject var team: TeamModel
    @Binding var selected: Set<String>

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(members.enumerated()), id: \.element.account) { index, member in
                    let on = selected.contains(member.account)
                    Button {
                        if on { selected.remove(member.account) } else { selected.insert(member.account) }
                    } label: {
                        HStack(spacing: 6) {
                            Avatar(account: member.account, name: member.name, size: 22)
                            Text(team.name(of: member.account, member.name)).font(.subheadline.weight(.medium))
                        }
                        .foregroundStyle(Palette.ink)
                        .padding(.leading, 5)
                        .padding(.trailing, 12)
                        .frame(minHeight: 34)
                        .background(on ? Palette.lime : Palette.sunken, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("decision.with.\(index)")
                }
            }
        }
    }
}
