import SwiftUI
import UpdatesCore

/// Write an update: title, category, TL;DR, KPIs, sections and asks, with a
/// preview. A plain native editor; the contract stores plain text.
struct ComposerView: View {
    @ObservedObject var audience: AudienceModel
    /// The published post's id, or nil when closed without publishing.
    let onDone: (String?) -> Void
    @StateObject private var model: ComposerModel
    @State private var preview = false
    @State private var tick = Date()

    init(audience: AudienceModel, start: ComposerStart, onDone: @escaping (String?) -> Void) {
        self.audience = audience
        self.onDone = onDone
        _model = StateObject(wrappedValue: ComposerModel(audience: audience, start: start))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let state = model.state {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            Picker("Mode", selection: $preview) {
                                Text("Write").tag(false)
                                Text("Preview").tag(true)
                            }
                            .pickerStyle(.segmented)
                            if preview {
                                ComposerPreview(state: state, series: model.series, audience: audience)
                            } else {
                                basics(state)
                                metrics(state)
                                sections(state)
                                asks(state)
                            }
                        }
                        .padding(16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .safeAreaInset(edge: .bottom) { publishBar }
                } else if let error = model.error {
                    VStack { Card { ErrorLine(message: error) } }.padding(16)
                    Spacer()
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .screenBackground()
            .navigationTitle(model.isEditing ? "Edit update" : "New update")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.isEditing ? "Cancel" : "Close") {
                        Task {
                            await model.flush()
                            audience.bump()
                            onDone(nil)
                        }
                    }
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(model.isEditing ? "Edit update" : "New update").font(.subheadline.weight(.semibold))
                        if let status = model.draftStatus(now: tick) {
                            Text(status).font(.caption2).foregroundStyle(Palette.ink2)
                        } else {
                            Text("Editing published update").font(.caption2).foregroundStyle(Palette.ink2)
                        }
                    }
                }
            }
            .task { await model.load() }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    tick = Date()
                }
            }
        }
        .interactiveDismissDisabled()
    }

    // MARK: - Write

    private func binding(_ get: @escaping (ComposerState) -> String, _ set: @escaping (inout ComposerState, String) -> Void)
        -> Binding<String>
    {
        Binding(
            get: { model.state.map(get) ?? "" },
            set: { value in model.update { set(&$0, value) } })
    }

    @ViewBuilder private func basics(_ state: ComposerState) -> some View {
        Card {
            TextField("Title — e.g. “June 2026 update”", text: binding(\.title) { $0.title = String($1.prefix(Limits.title)) }, axis: .vertical)
                .font(Typeface.display(22))
                .lineLimit(1...3)
            Divider()
            HStack {
                Text("Category").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                Spacer()
                if audience.categories.isEmpty {
                    Text("No categories yet — add them in Settings").font(.footnote).foregroundStyle(Palette.ink3)
                } else {
                    Picker("Category", selection: binding(\.categoryId) { $0.categoryId = $1 }) {
                        Text("No category").tag("")
                        ForEach(audience.categories) { Text("\($0.emoji) \($0.name)").tag($0.id) }
                    }
                    .pickerStyle(.menu)
                    .tint(Palette.ink)
                }
            }
            Divider()
            TextField(
                "TL;DR — the one paragraph a busy investor will read.",
                text: binding(\.summary) { $0.summary = String($1.prefix(Limits.summary)) }, axis: .vertical
            )
            .lineLimit(2...6)
        }
    }

    @ViewBuilder private func metrics(_ state: ComposerState) -> some View {
        Card {
            Label("KPIs", systemImage: "chart.bar").font(.headline).foregroundStyle(Palette.ink)
            ForEach(Array(state.metrics.enumerated()), id: \.offset) { index, metric in
                let previous = model.lastValue(of: metric.name)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        TextField("Name (MRR, Runway…)", text: binding({ $0.metrics[safe: index]?.name ?? "" }) { s, v in
                            if s.metrics.indices.contains(index) { s.metrics[index].name = v }
                        })
                        .font(.subheadline.weight(.semibold))
                        Button { model.removeMetric(index) } label: {
                            Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Palette.ink3)
                                .frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("Remove KPI")
                    }
                    HStack(spacing: 8) {
                        InputField(
                            placeholder: previous.map { "last: \($0)" } ?? "Value",
                            text: binding({ $0.metrics[safe: index]?.value ?? "" }) { s, v in
                                if s.metrics.indices.contains(index) { s.metrics[index].value = v }
                            })
                        InputField(
                            placeholder: "unit",
                            text: binding({ $0.metrics[safe: index]?.unit ?? "" }) { s, v in
                                if s.metrics.indices.contains(index) { s.metrics[index].unit = v }
                            }
                        )
                        .frame(width: 80)
                    }
                    if let previous {
                        if !metric.value.isEmpty, let delta = Metrics.delta(previous, metric.value) {
                            DeltaLabel(delta: delta)
                        } else {
                            Text("was \(previous)").font(.caption).foregroundStyle(Palette.ink3)
                        }
                    }
                }
                Divider()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(title: "KPI", icon: "plus") { model.addMetric() }
                    ForEach(model.knownMetrics) { known in
                        Chip(title: known.name, icon: "plus") { model.addMetric(name: known.name, unit: known.unit) }
                    }
                }
            }
            Text("Leave a value blank to skip it this time.").font(.caption).foregroundStyle(Palette.ink3)
        }
    }

    @ViewBuilder private func sections(_ state: ComposerState) -> some View {
        Card {
            Label("Sections", systemImage: "doc.text").font(.headline).foregroundStyle(Palette.ink)
            ForEach(Array(state.sections.enumerated()), id: \.offset) { index, section in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        TextField("Heading (optional)", text: binding({ $0.sections[safe: index]?.title ?? "" }) { s, v in
                            if s.sections.indices.contains(index) { s.sections[index].title = v }
                        })
                        .font(.subheadline.weight(.semibold))
                        Button { model.moveSectionUp(index) } label: {
                            Image(systemName: "arrow.up").font(.caption.weight(.bold)).frame(width: 30, height: 30)
                        }
                        .disabled(index == 0)
                        .accessibilityLabel("Move up")
                        Button { model.removeSection(index) } label: {
                            Image(systemName: "xmark").font(.caption.weight(.bold)).frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("Remove section")
                    }
                    .foregroundStyle(Palette.ink3)
                    InputField(
                        placeholder: UpdateTemplate.placeholder(for: section.kind),
                        text: binding({ $0.sections[safe: index]?.body ?? "" }) { s, v in
                            if s.sections.indices.contains(index) { s.sections[index].body = v }
                        }, axis: .vertical, lines: 4...14)
                }
            }
            Text("Add section").font(.caption.weight(.semibold)).foregroundStyle(Palette.ink2)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.sectionSuggestions, id: \.kind) { shape in
                        Chip(title: shape.title.isEmpty ? "Text" : shape.title, icon: "plus") { model.addSection(shape) }
                    }
                    if model.thanks != nil && !model.hasThanks {
                        Chip(
                            title: "Thank \(model.contributions.count) contributor\(model.contributions.count == 1 ? "" : "s")",
                            icon: "sparkles", selected: true
                        ) { model.insertThanks() }
                    }
                }
            }
        }
    }

    @ViewBuilder private func asks(_ state: ComposerState) -> some View {
        Card {
            Label("Asks", systemImage: "hand.raised").font(.headline).foregroundStyle(Palette.ink)
            Text(
                "Specific, answerable requests. Investors reply with one tap on “I can help”, and you accept offers from the Asks tab."
            )
            .font(.footnote).foregroundStyle(Palette.ink2)
            ForEach(Array(state.asks.enumerated()), id: \.offset) { index, ask in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Menu {
                            ForEach(AskKind.all, id: \.id) { kind in
                                Button { model.update { if $0.asks.indices.contains(index) { $0.asks[index].kind = kind.id } } } label: {
                                    Label(kind.label, systemImage: Symbols.askKind(kind.id))
                                }
                            }
                        } label: {
                            Label(AskKind.of(ask.kind).label, systemImage: Symbols.askKind(ask.kind))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Palette.ink)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 30)
                                .background(Palette.sunken, in: Capsule())
                        }
                        Spacer()
                        Button { model.removeAsk(index) } label: {
                            Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Palette.ink3)
                                .frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("Remove ask")
                    }
                    InputField(
                        placeholder: AskKind.of(ask.kind).hint,
                        text: binding({ $0.asks[safe: index]?.title ?? "" }) { s, v in
                            if s.asks.indices.contains(index) { s.asks[index].title = v }
                        })
                    InputField(
                        placeholder: "Detail (optional) — who exactly, and why",
                        text: binding({ $0.asks[safe: index]?.detail ?? "" }) { s, v in
                            if s.asks.indices.contains(index) { s.asks[index].detail = v }
                        }, axis: .vertical, lines: 1...4)
                }
                Divider()
            }
            Button { model.addAsk() } label: { Label("Ask", systemImage: "plus") }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                .disabled(!model.canAddAsk)
        }
    }

    private var publishBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error = model.error { ErrorLine(message: error) }
            if let blocker = model.blocker {
                Label(blocker, systemImage: "info.circle").font(.footnote).foregroundStyle(Palette.ink2)
            }
            Button {
                Task {
                    if let id = await model.publish() {
                        Haptics.success()
                        onDone(id)
                    } else {
                        Haptics.error()
                    }
                }
            } label: {
                if model.isPublishing {
                    HStack(spacing: 8) {
                        ProgressView().tint(Palette.ink)
                        Text("Publishing…")
                    }
                } else {
                    Label(model.isEditing ? "Save changes" : "Publish to this audience", systemImage: "paperplane")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isPublishing || model.blocker != nil)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

/// Roughly what an investor will see; the real render is the post screen.
private struct ComposerPreview: View {
    let state: ComposerState
    let series: [MetricSeries]
    @ObservedObject var audience: AudienceModel

    var body: some View {
        let input = state.toInput()
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Badge(title: "Preview", tone: .muted)
                if let category = audience.category(state.categoryId) { CategoryChip(category: category) }
            }
            Text(input.title.isEmpty ? "Untitled" : input.title).font(Typeface.display(28)).foregroundStyle(Palette.ink)
            if !input.summary.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("TL;DR").font(.caption.weight(.bold)).tracking(0.6)
                    Text(input.summary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if !input.metrics.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(Array(input.metrics.enumerated()), id: \.offset) { _, metric in
                        KpiTile(metric: metric, previous: Metrics.last(of: metric.name, in: series))
                    }
                }
            }
            ForEach(Array(input.sections.enumerated()), id: \.offset) { _, section in
                VStack(alignment: .leading, spacing: 6) {
                    if !section.title.isEmpty { Text(section.title).font(Typeface.display(19)) }
                    Text(section.body)
                }
            }
            if !input.asks.isEmpty {
                Label("How you can help", systemImage: "hand.raised").font(.headline)
                ForEach(Array(input.asks.enumerated()), id: \.offset) { _, ask in
                    Card {
                        Label(AskKind.of(ask.kind).label, systemImage: Symbols.askKind(ask.kind))
                            .font(.caption.weight(.semibold)).foregroundStyle(Palette.ink2)
                        Text(ask.title).font(.headline)
                        if !ask.detail.isEmpty { Text(ask.detail).font(.subheadline).foregroundStyle(Palette.ink2) }
                        Button {} label: { Label("I can help", systemImage: "hand.raised") }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(true)
                    }
                }
            }
        }
        .foregroundStyle(Palette.ink)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
