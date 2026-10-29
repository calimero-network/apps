import SwiftUI
import VoteCore

/// Create a poll. Its definition is frozen at creation (its hash is the poll
/// id), so everything a voter relies on is decided here.
struct NewPollSheet: View {
    @ObservedObject var model: GroupModel
    let me: String
    let created: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PollDraft
    @State private var planned = false
    @State private var closes = Date().addingTimeInterval(86_400)
    @State private var busy = false
    @State private var error: String?

    init(model: GroupModel, me: String, created: @escaping (String) -> Void) {
        self.model = model
        self.me = me
        self.created = created
        _draft = State(initialValue: PollDraft(me: me, roster: model.roster))
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(title: "New poll", action: "Create", canAct: draft.isValid, busy: busy, cancel: { dismiss() }, act: submit)
            Form {
                Section("Question") {
                    TextField("Where do we hold the offsite?", text: limited(\.title, VoteConstants.maxTitle), axis: .vertical)
                        .font(.system(size: 17, weight: .medium))
                }
                Section("Details (optional)") {
                    TextField("", text: limited(\.details, VoteConstants.maxDescription), axis: .vertical).lineLimit(2...6)
                }
                Section("Options") {
                    ForEach(draft.options.indices, id: \.self) { i in
                        HStack(spacing: 10) {
                            Text("\(i + 1).").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.muted)
                                .frame(width: 24, alignment: .leading)
                            TextField("Option \(i + 1)", text: optionBinding(i))
                            if draft.options.count > 2 {
                                Button {
                                    draft.options.remove(at: i)
                                } label: {
                                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Remove option \(i + 1)")
                            }
                        }
                    }
                    if draft.options.count < VoteConstants.maxOptions {
                        Button {
                            draft.options.append("")
                        } label: {
                            Label("Add option", systemImage: "plus")
                        }
                        .foregroundStyle(Palette.ink)
                    }
                }
                Section("Each voter may pick") {
                    radio("Exactly one option", on: draft.mode == .single) { draft.mode = .single }
                    radio("Up to \(draft.maxC) options (approval)", on: draft.mode == .multi) { draft.mode = .multi }
                    if draft.mode == .multi {
                        Stepper(
                            "Up to \(draft.maxC)", value: $draft.maxChoices, in: 1...max(draft.filled.count, 1))
                    }
                }
                Section {
                    Text(
                        "Trustees generate the election key together, so no one ever holds all of it. Any threshold of them can decrypt the totals; fewer learn nothing."
                    )
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    chips(selected: $draft.trustees)
                    if draft.trustees.count > 1 {
                        Stepper(
                            "Any \(draft.threshold) of the \(draft.trustees.count) trustees can decrypt the totals.",
                            value: Binding(get: { draft.threshold }, set: { draft.thresholdPick = $0 }),
                            in: 1...draft.trustees.count)
                    }
                    if let note = draft.trusteeNote(me: me) {
                        if note.warning {
                            Callout(tone: .warning, title: note.text)
                        } else {
                            Text(note.text).font(.system(size: 14)).foregroundStyle(Palette.muted)
                        }
                    }
                } header: {
                    Text("Trustees")
                }
                Section("Who can vote") {
                    radio("Every member of this group", on: draft.everyone) { draft.everyone = true }
                    radio("Only these members:", on: !draft.everyone) { draft.everyone = false }
                    if !draft.everyone { chips(selected: $draft.voters) }
                }
                Section {
                    Toggle("Show a planned close", isOn: $planned).tint(Palette.lime)
                    if planned {
                        DatePicker("Planned close", selection: $closes, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    }
                } header: {
                    Text("Planned close")
                } footer: {
                    Text("Shown to voters; you close the poll yourself.")
                }
                Section {
                    if let error { Text(error).foregroundStyle(Palette.danger) }
                    Text("Everything here is frozen once the poll is created.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.ground)
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy)
    }

    private func limited(_ key: WritableKeyPath<PollDraft, String>, _ max: Int) -> Binding<String> {
        Binding(get: { draft[keyPath: key] }, set: { draft[keyPath: key] = String($0.prefix(max)) })
    }

    private func optionBinding(_ i: Int) -> Binding<String> {
        Binding(
            get: { draft.options.indices.contains(i) ? draft.options[i] : "" },
            set: { if draft.options.indices.contains(i) { draft.options[i] = String($0.prefix(VoteConstants.maxOption)) } })
    }

    private func radio(_ title: String, on: Bool, _ pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            HStack(spacing: 10) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(on ? Palette.ink : Palette.muted)
                Text(title).foregroundStyle(Palette.ink)
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }

    private func chips(selected: Binding<Set<String>>) -> some View {
        FlowLayout(spacing: 8) {
            ForEach(model.people, id: \.account) { m in
                let on = selected.wrappedValue.contains(m.account)
                Button {
                    if on { selected.wrappedValue.remove(m.account) } else { selected.wrappedValue.insert(m.account) }
                    Haptics.tap()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: on ? "checkmark" : "plus").font(.system(size: 11, weight: .bold))
                        Text(personLabel(m)).font(.system(size: 14, weight: .medium))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(on ? Palette.lime : Palette.sunken))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }

    private func personLabel(_ m: Member) -> String {
        if m.account == me { return "\(m.name.isEmpty ? "You" : m.name) (you)" }
        return m.name.isEmpty ? VoteFormat.short(m.account) : m.name
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        error = nil
        draft.closesAt = planned ? UInt64(closes.timeIntervalSince1970 * 1000) : nil
        Haptics.tap()
        Task {
            do {
                let id = try await model.createPoll(draft)
                Haptics.success()
                dismiss()
                created(id)
            } catch {
                self.error = VoteErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Lays chips out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += line + spacing
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
        }
        return CGSize(width: width == .infinity ? x : width, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + spacing
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
