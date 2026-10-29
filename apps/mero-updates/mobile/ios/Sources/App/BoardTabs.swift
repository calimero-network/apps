import SwiftUI
import UpdatesCore

/// Every ask across the updates, and the ledger of accepted offers.
struct AsksTab: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: AsksModel

    init(audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: AsksModel(audience: audience))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PageHeader(
                        title: "Asks",
                        subtitle: audience.isTeam
                            ? "Every request for help across your updates, and the offers that came in."
                            : "Specific ways you can help the team right now.")
                    Picker("Status", selection: Binding(get: { model.status }, set: { s in Task { await model.show(status: s) } })) {
                        Text("Open").tag("open")
                        Text("Resolved").tag("resolved")
                    }
                    .pickerStyle(.segmented)
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if !model.hasLoaded {
                        SkeletonCard()
                    } else if model.asks.isEmpty {
                        Card {
                            EmptyState(
                                icon: "hand.raised",
                                title: model.status == "open" ? "No open asks." : "Nothing resolved yet.",
                                message: audience.isTeam
                                    ? "Add asks to an update — intros, hires, customers, advice. They collect here."
                                    : "When the team asks for help, it shows up here.")
                        }
                    } else {
                        ForEach(model.asks) { AskCardView(ask: $0, audience: audience, showPost: true) }
                    }
                    if !model.contributions.isEmpty { ledger }
                }
                .padding(16)
            }
            .screenBackground()
            .audienceToolbar(audience)
            .refreshable { await model.load() }
            .task(id: audience.version) { await model.load() }
            .navigationDestination(for: PostRoute.self) { PostScreen(postId: $0.id, audience: audience) }
        }
    }

    private var ledger: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: "Contributions")
            Text("Accepted offers of help. The composer can thank everyone since the last update in one tap.")
                .font(.footnote).foregroundStyle(Palette.ink2).padding(.horizontal, 4)
            Card(padding: 12) {
                ForEach(model.contributions) { c in
                    HStack(alignment: .top, spacing: 10) {
                        Avatar(account: c.account, name: c.name, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(People.label(c.name, c.account)).font(.subheadline.weight(.semibold))
                                if !c.firm.isEmpty { Text("· \(c.firm)").font(.footnote).foregroundStyle(Palette.ink2) }
                            }
                            Label("\(AskKind.of(c.askKind).label) · \(c.askTitle)", systemImage: Symbols.askKind(c.askKind))
                                .font(.footnote).foregroundStyle(Palette.ink2).lineLimit(2)
                        }
                        Spacer()
                        Text(Format.formatDate(c.acceptedAt)).font(.caption).foregroundStyle(Palette.ink3)
                    }
                }
            }
        }
    }
}

/// Questions and answers everyone in this audience can read.
struct QuestionsTab: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: QuestionsModel
    @State private var path: [PostRoute] = []
    @State private var asking = false

    init(audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: QuestionsModel(audience: audience))
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PageHeader(title: "Q&A", subtitle: "Questions and answers everyone in this audience can read.")
                    Button { asking = true } label: {
                        Label(audience.isTeam ? "Start a thread" : "Ask the team", systemImage: "questionmark.bubble")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Picker("Filter", selection: $model.openOnly) {
                        Text("All").tag(false)
                        Text("Unanswered").tag(true)
                    }
                    .pickerStyle(.segmented)
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if !model.hasLoaded {
                        SkeletonCard(height: 72)
                    } else if model.shown.isEmpty {
                        Card {
                            EmptyState(
                                icon: "questionmark.bubble",
                                title: model.openOnly ? "Nothing waiting on an answer." : "No questions yet.",
                                message: "Questions and answers are visible to everyone in this audience.")
                        }
                    } else {
                        Card(padding: 4) {
                            ForEach(model.shown) { q in
                                NavigationLink(value: PostRoute(id: q.id)) { QuestionRow(question: q) }
                                    .buttonStyle(.plain)
                                if q.id != model.shown.last?.id { Divider().padding(.leading, 56) }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .audienceToolbar(audience)
            .refreshable { await model.load() }
            .task(id: audience.version) { await model.load() }
            .navigationDestination(for: PostRoute.self) { PostScreen(postId: $0.id, audience: audience) }
            .sheet(isPresented: $asking) {
                AskQuestionSheet(model: model, isTeam: audience.isTeam) { id in
                    asking = false
                    path = [PostRoute(id: id)]
                }
            }
        }
    }
}

private struct QuestionRow: View {
    let question: PostCard

    var body: some View {
        HStack(spacing: 12) {
            Avatar(account: question.author, name: question.authorName, team: question.authorIsTeam, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(question.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading).lineLimit(2)
                Text("\(People.label(question.authorName, question.author)) · \(Format.timeAgo(question.createdAt))")
                    .font(.caption).foregroundStyle(Palette.ink2)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                Badge(
                    title: question.status == "answered" ? "Answered" : "Open",
                    tone: question.status == "answered" ? .good : .warn)
                Label("\(question.commentCount)", systemImage: "bubble.left").font(.caption).foregroundStyle(Palette.ink2)
            }
        }
        .padding(12)
        .contentShape(Rectangle())
    }
}

private struct AskQuestionSheet: View {
    @ObservedObject var model: QuestionsModel
    let isTeam: Bool
    let onPosted: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var details = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField(
                    isTeam ? "e.g. “Office hours this Friday — bring questions”" : "e.g. “What's the runway after the new hires?”",
                    text: $title, axis: .vertical
                )
                .lineLimit(1...3)
                .focused($focused)
                .padding(12)
                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onChange(of: title) { if $0.count > Limits.title { title = String($0.prefix(Limits.title)) } }
                InputField(placeholder: "Details (optional)", text: $details, axis: .vertical, lines: 3...8)
                Label("Everyone in this audience can read the thread.", systemImage: "eye")
                    .font(.footnote).foregroundStyle(Palette.ink2)
                if let error = model.error { ErrorLine(message: error) }
                Button {
                    Task {
                        if let id = await model.ask(title: title, body: details) {
                            Haptics.success()
                            onPosted(id)
                        } else {
                            Haptics.error()
                        }
                    }
                } label: {
                    Text(model.isPosting ? "Posting…" : "Post")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isPosting || title.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle(isTeam ? "Start a thread" : "Ask the team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                model.error = nil
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Every metric reported in an update, as a series.
struct KpisTab: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: MetricsModel

    init(audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: MetricsModel(audience: audience))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PageHeader(title: "KPIs", subtitle: "Every metric reported in an update, as a series. Nothing is typed twice.")
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if !model.hasLoaded {
                        SkeletonCard(height: 160)
                    } else if model.series.isEmpty {
                        Card {
                            EmptyState(
                                icon: "chart.bar", title: "No KPIs reported yet.",
                                message: "KPIs added to an update show up here as a trend, one line per metric.")
                        }
                    } else {
                        ForEach(model.series) { MetricCard(series: $0) }
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .audienceToolbar(audience)
            .refreshable { await model.load() }
            .task(id: audience.version) { await model.load() }
            .navigationDestination(for: PostRoute.self) { PostScreen(postId: $0.id, audience: audience) }
        }
    }
}

private struct MetricCard: View {
    let series: MetricSeries
    @State private var expanded = false

    var body: some View {
        let last = series.points[series.points.count - 1]
        Card {
            HStack {
                Text(series.name.uppercased()).font(.caption.weight(.semibold)).tracking(0.5).foregroundStyle(Palette.ink2)
                Spacer()
                Text("as of \(Format.formatDate(last.at))").font(.caption).foregroundStyle(Palette.ink3)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(last.value).font(Typeface.display(30)).foregroundStyle(Palette.ink)
                if !series.unit.isEmpty { Text(series.unit).font(.subheadline).foregroundStyle(Palette.ink2) }
            }
            if let delta = MetricsModel.latestDelta(series) {
                HStack(spacing: 6) {
                    DeltaLabel(delta: delta)
                    Text("since last report").font(.caption).foregroundStyle(Palette.ink3)
                }
            } else {
                Text("First report").font(.caption).foregroundStyle(Palette.ink3)
            }
            Sparkline(values: series.points.map(\.value))
            DisclosureGroup(isExpanded: $expanded) {
                VStack(spacing: 0) {
                    ForEach(Array(series.points.reversed().enumerated()), id: \.offset) { _, point in
                        NavigationLink(value: PostRoute(id: point.postId)) {
                            HStack {
                                Text(Format.formatDate(point.at)).font(.footnote).foregroundStyle(Palette.ink2)
                                    .frame(width: 96, alignment: .leading)
                                Text(point.postTitle).font(.footnote).foregroundStyle(Palette.ink).lineLimit(1)
                                Spacer()
                                Text(point.value).font(.footnote.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(Palette.ink)
                            }
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } label: {
                Text("\(series.points.count) report\(series.points.count == 1 ? "" : "s")")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
            }
            .tint(Palette.ink2)
        }
    }
}
