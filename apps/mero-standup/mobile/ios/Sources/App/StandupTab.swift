import StandupCore
import SwiftUI

/// One day's standup: the week strip, your update, the team's, who has not
/// posted, what blocks people right now and what was decided that day.
struct StandupTab: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var board: BoardModel
    let onLogDecision: (String) -> Void

    @State private var composing = false
    @State private var helping: UpdateView?
    @State private var confirmWithdraw = false
    @State private var actionError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    WeekStrip(board: board)
                    if board.dayView == nil, let error = board.error {
                        Card {
                            HStack(spacing: 10) {
                                ProgressView()
                                Text("Syncing this team…").font(.headline).foregroundStyle(Palette.ink)
                            }
                            Text("Its updates arrive from the other members' nodes. This can take a minute after joining.")
                                .font(.subheadline).foregroundStyle(Palette.ink2)
                            ErrorLine(message: error)
                        }
                    } else if let error = board.error ?? actionError {
                        Card { ErrorLine(message: error) }
                    }
                    myUpdate
                    teamSection
                    if board.isToday { waitingSection }
                    blockersSection
                    decidedSection
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(team.title)
            .refreshable {
                await team.load()
                await board.load()
            }
            .task { await board.load() }
            .onChange(of: team.version) { _ in Task { await board.load() } }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: {
                        Image(systemName: "square.and.pencil").accessibilityLabel("Post update")
                    }
                }
            }
            .sheet(isPresented: $composing) { UpdateSheet(board: board) }
            .sheet(item: $helping) { update in HelpSheet(board: board, update: update) }
            .confirmationDialog("Withdraw your update?", isPresented: $confirmWithdraw, titleVisibility: .visible) {
                Button("Withdraw", role: .destructive) { withdraw() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("It disappears from the team's day. You can post again.")
            }
        }
    }

    // MARK: Your update

    @ViewBuilder private var myUpdate: some View {
        if let mine = board.mine {
            Card {
                HStack(spacing: 10) {
                    Avatar(account: mine.author, name: team.myName)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Your update").font(.headline).foregroundStyle(Palette.ink)
                        Text(Days.relative(nanos: mine.editedAt)).font(.caption).foregroundStyle(Palette.ink2)
                    }
                    Spacer()
                    Badge(title: "Posted")
                }
                UpdateFields(update: mine)
                if !mine.helpers.isEmpty { Helpers(team: team, helpers: mine.helpers) }
                HStack(spacing: 10) {
                    Button { composing = true } label: { Label("Edit", systemImage: "pencil") }
                        .buttonStyle(SecondaryButtonStyle())
                    Button { confirmWithdraw = true } label: { Label("Withdraw", systemImage: "trash") }
                        .buttonStyle(SecondaryButtonStyle(tint: Palette.danger))
                }
            }
        } else if board.dayView != nil {
            Card {
                Text(board.isToday ? "Your update for today" : "Your update for \(board.dayTitle)")
                    .font(.headline).foregroundStyle(Palette.ink)
                if let from = board.carriedFrom {
                    Label("Started from your \(board.describe(from).lowercased()) update", systemImage: "arrow.uturn.forward")
                        .font(.subheadline).foregroundStyle(Palette.ink2)
                } else {
                    Text("Takes a few seconds: done, next, anything in your way.")
                        .font(.subheadline).foregroundStyle(Palette.ink2)
                }
                Button { composing = true } label: { Label("Post update", systemImage: "square.and.pencil") }
                    .buttonStyle(PrimaryButtonStyle())
            }
        } else if board.isLoading {
            Card { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12) }
        }
    }

    // MARK: The team

    @ViewBuilder private var teamSection: some View {
        let others = board.others
        SectionLabel(title: "Team", trailing: others.isEmpty ? nil : "\(others.count) posted")
        if board.dayView != nil, others.isEmpty {
            Card {
                Text(
                    board.isToday
                        ? "Nobody else has posted today yet. Updates appear here as teammates' nodes sync."
                        : "Nobody else posted for \(board.dayTitle.lowercased())."
                )
                .font(.subheadline).foregroundStyle(Palette.ink2)
            }
        }
        ForEach(others, id: \.author) { update in
            Card {
                HStack(spacing: 10) {
                    Avatar(account: update.author, name: update.authorName)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(team.name(of: update.author, update.authorName)).font(.headline).foregroundStyle(Palette.ink)
                        Text(Days.relative(nanos: update.editedAt) + (update.editedAt != update.createdAt ? " · edited" : ""))
                            .font(.caption).foregroundStyle(Palette.ink2)
                    }
                    Spacer()
                    Menu {
                        Button { onLogDecision(update.day) } label: { Label("Log decision", systemImage: "checkmark.seal") }
                    } label: {
                        Image(systemName: "ellipsis").font(.body.weight(.semibold)).foregroundStyle(Palette.ink2)
                            .frame(width: 36, height: 36).contentShape(Rectangle())
                    }
                    .accessibilityLabel("More")
                }
                UpdateFields(update: update)
                if !update.blockers.isEmpty {
                    if !update.helpers.isEmpty { Helpers(team: team, helpers: update.helpers) }
                    if board.offered(update) {
                        Button("Withdraw your offer") { run { try await board.withdrawHelp(on: update) } }
                            .font(.subheadline.weight(.medium)).foregroundStyle(Palette.ink2)
                    } else if team.me != nil {
                        Chip(title: "I can help", icon: "hand.raised") { helping = update }
                    }
                }
            }
            .contextMenu {
                Button { onLogDecision(update.day) } label: { Label("Log decision", systemImage: "checkmark.seal") }
            }
        }
    }

    @ViewBuilder private var waitingSection: some View {
        SectionLabel(title: "Not posted yet")
        Card {
            if board.waiting.isEmpty {
                Text("Everyone the app knows about has posted.").font(.subheadline).foregroundStyle(Palette.ink2)
            } else {
                ForEach(board.waiting, id: \.account) { member in
                    HStack(spacing: 10) {
                        Avatar(account: member.account, name: member.name, size: 28)
                        Text(team.name(of: member.account, member.name)).font(.subheadline).foregroundStyle(Palette.ink)
                    }
                }
            }
        }
    }

    @ViewBuilder private var blockersSection: some View {
        SectionLabel(title: "Blocked right now")
        Card {
            if board.blockers.isEmpty {
                Text("Nothing is blocking anyone.").font(.subheadline).foregroundStyle(Palette.ink2)
            }
            ForEach(Array(board.blockers.enumerated()), id: \.element.author) { index, update in
                if index > 0 { Divider().overlay(Palette.hairline) }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Avatar(account: update.author, name: update.authorName, size: 26)
                        Text(team.name(of: update.author, update.authorName)).font(.subheadline.weight(.semibold))
                        Spacer()
                        Button(board.describe(update.day)) { Task { await board.select(update.day) } }
                            .font(.footnote.weight(.medium)).foregroundStyle(Palette.ink2)
                    }
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.danger).font(.footnote)
                        RichTextView(text: update.blockers)
                    }
                    if !update.helpers.isEmpty { Helpers(team: team, helpers: update.helpers) }
                }
            }
        }
    }

    @ViewBuilder private var decidedSection: some View {
        if !board.decided.isEmpty {
            SectionLabel(title: board.isToday ? "Decided today" : "Decided on \(board.dayTitle)")
            Card {
                ForEach(board.decided, id: \.id) { decision in
                    (Text(decision.title).fontWeight(.semibold) + Text(" — \(decision.decision)").foregroundColor(Palette.ink2))
                        .font(.subheadline).lineLimit(3)
                }
            }
        }
    }

    private func withdraw() {
        run {
            try await board.withdraw()
            Haptics.success()
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                actionError = nil
            } catch {
                actionError = StandupCore.ErrorText.describe(error)
                Haptics.error()
            }
        }
    }
}

/// The week around the day, a dot per day someone posted, red if anyone was blocked.
private struct WeekStrip: View {
    @ObservedObject var board: BoardModel

    var body: some View {
        Card(padding: 12) {
            HStack(spacing: 2) {
                Button { Task { await board.shift(by: -1) } } label: {
                    Image(systemName: "chevron.left").frame(width: 30, height: 44)
                }
                .accessibilityLabel("Previous day")
                ForEach(board.weekDays, id: \.self) { day in
                    dayCell(day)
                }
                Button { Task { await board.shift(by: 1) } } label: {
                    Image(systemName: "chevron.right").frame(width: 30, height: 44)
                }
                .disabled(board.isToday)
                .accessibilityLabel("Next day")
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.ink)
            HStack {
                Text(board.dayTitle).font(.title3.weight(.semibold)).foregroundStyle(Palette.ink)
                Spacer()
                if !board.isToday {
                    Button("Today") { Task { await board.select(board.today) } }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func dayCell(_ day: String) -> some View {
        let selected = day == board.day
        let summary = board.summary(of: day)
        let future = board.isFuture(day)
        return Button {
            Haptics.tap()
            Task { await board.select(day) }
        } label: {
            VStack(spacing: 3) {
                Text(Days.weekdayShort(day)).font(.caption2.weight(.medium)).foregroundStyle(selected ? Palette.ink : Palette.ink2)
                Text(Days.dayNumber(day)).font(.callout.weight(.semibold)).foregroundStyle(Palette.ink)
                HStack(spacing: 2) {
                    Circle().fill(summary.blocked ? Palette.danger : Palette.ink)
                        .frame(width: 5, height: 5).opacity(summary.count > 0 ? 1 : 0)
                    if summary.count > 1 { Text("\(summary.count)").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.ink2) }
                }
                .frame(height: 9)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(selected ? Palette.lime : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(day == board.today && !selected ? Palette.ink : .clear, lineWidth: 1))
            .opacity(future ? 0.35 : 1)
        }
        .buttonStyle(.plain)
        .disabled(future)
        .accessibilityLabel("\(board.describe(day)), \(summary.count) update\(summary.count == 1 ? "" : "s")")
    }
}

struct UpdateFields: View {
    let update: UpdateView

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !update.done.isEmpty { FieldBlock(label: "Done", text: update.done) }
            if !update.next.isEmpty { FieldBlock(label: "Next", text: update.next) }
            if !update.blockers.isEmpty { FieldBlock(label: "Blocked", text: update.blockers, danger: true) }
        }
    }
}

private struct Helpers: View {
    @ObservedObject var team: TeamModel
    let helpers: [HelpView]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(helpers, id: \.account) { helper in
                HStack(spacing: 8) {
                    Avatar(account: helper.account, name: helper.name, size: 22)
                    (Text(team.name(of: helper.account, helper.name)).fontWeight(.semibold)
                        + Text(helper.note.isEmpty ? " can help" : " — \(helper.note)").foregroundColor(Palette.ink2))
                        .font(.footnote)
                }
            }
        }
    }
}

/// Post or edit your update: Done, Next, Blockers, carried forward from your last one.
private struct UpdateSheet: View {
    @ObservedObject var board: BoardModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = UpdateDraft()
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Field { case done, next, blockers }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let from = board.carriedFrom {
                        Label("Started from your \(board.describe(from).lowercased()) update", systemImage: "arrow.uturn.forward")
                            .font(.footnote).foregroundStyle(Palette.ink2)
                    }
                    LabelledEditor(label: "Done", placeholder: "What got done since your last update", text: $draft.done, minLines: 3)
                        .focused($focus, equals: .done)
                    LabelledEditor(label: "Next", placeholder: "What you are on next", text: $draft.next)
                        .focused($focus, equals: .next)
                    LabelledEditor(label: "Blockers", placeholder: "Anything in your way? Leave empty if not", text: $draft.blockers, minLines: 1)
                        .focused($focus, equals: .blockers)
                    Text("Start a line with - for a list. Links and `code` just work.")
                        .font(.footnote).foregroundStyle(Palette.ink3)
                    if let error { ErrorLine(message: error) }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: post) {
                        if busy { ProgressView() } else { Text(board.mine == nil ? "Post" : "Save").fontWeight(.semibold) }
                    }
                    .disabled(busy || draft.isEmpty)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: post) { Text(busy ? "Posting…" : board.mine == nil ? "Post update" : "Save update") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || draft.isEmpty)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(.bar)
            }
            .onAppear {
                draft = board.draft
                focus = draft.done.isEmpty ? .done : draft.next.isEmpty ? .next : .done
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy)
    }

    private var title: String {
        if board.mine != nil { return "Edit your update" }
        return board.isToday ? "Today's update" : "Update for \(board.dayTitle)"
    }

    private func post() {
        guard !busy, !draft.isEmpty else { return }
        busy = true
        Task {
            do {
                try await board.post(draft)
                Haptics.success()
                dismiss()
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
                Haptics.error()
            }
            busy = false
        }
    }
}

/// Offer help on someone's blocker, with an optional note.
private struct HelpSheet: View {
    @ObservedObject var board: BoardModel
    let update: UpdateView
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                FieldBlock(label: "Blocked", text: update.blockers, danger: true)
                TextField("How? (optional)", text: $note, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($focused)
                    .padding(12)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onChange(of: note) { if $0.count > Limits.help { note = String($0.prefix(Limits.help)) } }
                if let error { ErrorLine(message: error) }
                Button(action: offer) { Label(busy ? "Offering…" : "Offer help", systemImage: "hand.raised") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Offer help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func offer() {
        busy = true
        Task {
            do {
                try await board.offerHelp(on: update, note: note)
                Haptics.success()
                dismiss()
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
            }
            busy = false
        }
    }
}
