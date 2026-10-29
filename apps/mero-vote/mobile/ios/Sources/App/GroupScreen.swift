import MeroKit
import SwiftUI
import VoteCore

/// One voting group: its polls, who is here, and a way to invite more.
struct GroupScreen: View {
    @StateObject private var model: GroupModel
    let open: (PollRoute) -> Void
    @State private var sheet: GroupSheet?

    init(backend: any MeroAppBackend, group: GroupRef, open: @escaping (PollRoute) -> Void) {
        _model = StateObject(wrappedValue: GroupModel(backend: backend, group: group))
        self.open = open
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                switch model.phase {
                case .loading:
                    ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.refresh() } }
                case .loaded:
                    if model.myName == nil { nameCard }
                    stats
                    if model.polls.isEmpty {
                        Card {
                            EmptyState(
                                symbol: "chart.bar.fill", title: "No polls yet",
                                message: "Start one with New poll — ballots are encrypted on each voter's device.",
                                action: ("New poll", { sheet = .newPoll }))
                        }
                    } else {
                        ForEach(model.polls, id: \.pollId) { poll in
                            Button {
                                open(PollRoute(group: model.group, pollId: poll.pollId))
                            } label: {
                                PollCard(poll: poll, creator: model.label(poll.creator))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 80)
        }
        .background(Palette.ground)
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
        .task { await model.watch() }
        .overlay(alignment: .top) {
            if let notice = model.notice { NoticeBanner(text: notice) { model.notice = nil } }
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                Haptics.tap()
                sheet = .newPoll
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 58, height: 58)
                    .background(Circle().fill(Palette.lime))
                    .shadow(color: Palette.ink.opacity(0.18), radius: 10, y: 4)
            }
            .padding(20)
            .disabled(model.me == nil)
            .accessibilityLabel("New poll")
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.surface, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text("Polls").font(Typeface.display(17)).foregroundStyle(Palette.ink)
                    Text(model.group.workspaceName).font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(1)
                }
            }
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button { sheet = .members } label: { Image(systemName: "person.2") }
                    .accessibilityLabel("Members")
                Button { sheet = .invite } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Invite someone")
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .newPoll:
                if let me = model.me {
                    NewPollSheet(model: model, me: me) { id in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            open(PollRoute(group: model.group, pollId: id))
                        }
                    }
                }
            case .members:
                MembersSheet(model: model)
            case .invite:
                InviteSheet(model: model)
            case .name:
                NameSheet(
                    title: "Your name", placeholder: "Your name", action: "Save",
                    note: "Your name in this voting group. Others pick voters and trustees by it.",
                    initial: model.myName ?? ""
                ) { name in
                    try await model.setName(name)
                }
            }
        }
    }

    private var nameCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "person")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 38, height: 38)
                .background(Circle().fill(Palette.lime))
            VStack(alignment: .leading, spacing: 4) {
                Text("Pick a name").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                Text("Pick a name so others can add you as a voter or trustee.")
                    .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
            }
            Spacer(minLength: 0)
            Button("Set name") { sheet = .name }.buttonStyle(PrimaryButtonStyle(compact: true))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
    }

    private var stats: some View {
        HStack(spacing: 10) {
            stat("chart.bar.fill", model.count(.voting), "Open for voting", accent: true)
            stat("key.fill", model.count(.keyCeremony), "In key ceremony")
            stat("checkmark", model.count(.closing, .closed), "Closed or counting")
        }
    }

    private func stat(_ symbol: String, _ n: Int, _ label: String, accent: Bool = false) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(accent ? Palette.lime : Palette.sunken))
                Text("\(n)").font(Typeface.display(22)).foregroundStyle(Palette.ink).monospacedDigit()
                Text(label).font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(2, reservesSpace: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

enum GroupSheet: String, Identifiable {
    case newPoll, members, invite, name
    var id: String { rawValue }
}

/// One poll in the list: phase, question, who made it, ballots, and where it stands.
struct PollCard: View {
    let poll: PollSummary
    let creator: String

    var body: some View {
        let at = VoteFormat.stepIndex(poll.phase)
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    PhaseBadge(phase: poll.phase)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
                }
                Text(poll.title).font(Typeface.display(18)).foregroundStyle(Palette.ink).lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 14) {
                    Label(creator, systemImage: "person")
                    Label(
                        VoteFormat.count(Int(poll.ballots), "ballot", "ballots"),
                        systemImage: poll.phase == .keyCeremony ? "clock" : "checkmark")
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.muted)
                HStack(spacing: 4) {
                    ForEach(0..<4, id: \.self) { i in
                        Capsule()
                            .fill(i < at ? Palette.ink : i == at ? Palette.lime : Palette.sunken)
                            .frame(height: 4)
                    }
                }
                .accessibilityHidden(true)
            }
            .padding(14)
        }
        .contentShape(Rectangle())
    }
}

/// You (and your name on the roster) and everyone else here.
struct MembersSheet: View {
    @ObservedObject var model: GroupModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section("You") {
                    HStack(spacing: 12) {
                        Avatar(label: model.myName ?? "You", seed: model.me ?? "you", size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.myName ?? "No name yet").font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                            Text(VoteFormat.short(model.me ?? "")).font(.system(size: 13, design: .monospaced))
                                .foregroundStyle(Palette.muted)
                        }
                    }
                    HStack {
                        TextField("Your name", text: $name)
                            .onChange(of: name) { value in
                                if value.count > VoteConstants.maxName { name = String(value.prefix(VoteConstants.maxName)) }
                            }
                        Button(model.myName == nil ? "Join roster" : "Rename") { save() }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    }
                    if let error { Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger) }
                }
                Section {
                    if model.roster.isEmpty {
                        Text("Nobody has joined the roster yet.").foregroundStyle(Palette.muted)
                    }
                    ForEach(model.roster, id: \.account) { m in
                        HStack(spacing: 12) {
                            Avatar(label: model.label(m.account), seed: m.account, size: 36)
                            Text(model.label(m.account) + (m.account == model.me ? " (you)" : ""))
                                .foregroundStyle(Palette.ink)
                            Spacer()
                            Text(VoteFormat.short(m.account)).font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(Palette.muted)
                        }
                    }
                } header: {
                    Text("Members (\(model.roster.count))")
                } footer: {
                    Text("Everyone here can vote and audit.")
                }
            }
            .voteNavigation("Members")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        busy = true
        error = nil
        Task {
            do {
                try await model.setName(name)
                name = ""
                Haptics.success()
            } catch {
                self.error = VoteErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Mint an invitation link to this voting group, then share or copy it.
struct InviteSheet: View {
    @ObservedObject var model: GroupModel
    @Environment(\.dismiss) private var dismiss
    @State private var link: String?
    @State private var busy = false
    @State private var copied = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Invite someone").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Spacer()
                Button("Done") { dismiss() }.foregroundStyle(Palette.ink)
            }
            Text("One link. Whoever opens it joins this voting group and sees its polls.")
                .font(.system(size: 15)).foregroundStyle(Palette.muted)
            if let link {
                Text(link)
                    .font(.system(size: 13, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(Palette.ink)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
                HStack(spacing: 10) {
                    ShareLink(item: link) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = link
                        copied = true
                        Haptics.tap()
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                Button {
                    mint()
                } label: {
                    if busy {
                        Text("Creating…")
                    } else {
                        Label("Create invite link", systemImage: "link")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
            }
            if let error { Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger) }
            Spacer(minLength: 0)
        }
        .padding(24)
        .background(Palette.surface)
        .presentationDetents([.medium])
    }

    private func mint() {
        busy = true
        error = nil
        Haptics.tap()
        Task {
            do {
                link = try await model.inviteLink()
                Haptics.success()
            } catch {
                self.error = VoteErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}
