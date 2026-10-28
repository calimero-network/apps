import MeroKit
import MeroKitUI
import SwiftUI
import VoteCore

/// Every workspace you are in, and the voting groups in each.
struct GroupsScreen: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var model: GroupsModel
    let openInvitation: (String) -> Void
    let open: (GroupRef) -> Void
    @State private var sheet: GroupsSheet?
    @State private var notice: String?

    init(
        backend: any MeroAppBackend, applicationId: String, openInvitation: @escaping (String) -> Void,
        open: @escaping (GroupRef) -> Void
    ) {
        _model = StateObject(wrappedValue: GroupsModel(backend: backend, applicationId: applicationId))
        self.openInvitation = openInvitation
        self.open = open
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !model.hasRelay {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "antenna.radiowaves.left.and.right.slash")
                        Text("Your account has no relay yet. Join a voting group from an invitation link to get one.")
                            .font(.system(size: 14))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                }
                switch model.phase {
                case .loading:
                    ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.load() } }
                case .loaded where model.sections.isEmpty:
                    EmptyState(
                        symbol: "square.stack.3d.up",
                        title: "No voting groups yet",
                        message: "Create a workspace for your group, or join one from an invitation link.",
                        action: ("New workspace", { sheet = .newWorkspace }))
                    Button("Join with a link") { sheet = .join }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                        .frame(maxWidth: .infinity)
                case .loaded:
                    ForEach(model.sections) { section in
                        sectionView(section)
                    }
                }
            }
            .padding(16)
        }
        .background(Palette.ground)
        .refreshable { await model.load() }
        .task { await model.load() }
        .overlay(alignment: .top) {
            if let notice { NoticeBanner(text: notice) { self.notice = nil } }
        }
        .voteNavigation("Voting groups")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { sheet = .account } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { sheet = .newWorkspace } label: { Label("New workspace", systemImage: "square.stack.3d.up") }
                    Button { sheet = .join } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add")
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .newWorkspace:
                NameSheet(
                    title: "New workspace", placeholder: "Workspace name", action: "Create",
                    note: "A workspace holds voting groups. The first group is created with it, and you can invite people to it right away."
                ) { name in
                    let group = try await model.createWorkspace(name: name)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { open(group) }
                }
            case .join:
                JoinSheet { link in
                    sheet = nil
                    // After this sheet is down: the invitation sheet is presented from the root.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { openInvitation(link) }
                }
            case .account:
                AccountSheet()
            }
        }
    }

    private func sectionView(_ section: WorkspaceSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(section.name).font(Typeface.display(18)).foregroundStyle(Palette.ink).lineLimit(1)
                Spacer()
                Button {
                    Haptics.tap()
                    Task {
                        do {
                            open(try await model.createGroup(in: section))
                            Haptics.success()
                        } catch {
                            notice = VoteErrorText.describe(error)
                            Haptics.failure()
                        }
                    }
                } label: {
                    Label("New group", systemImage: "plus").font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(Palette.ink)
                .disabled(model.isCreating)
            }
            .padding(.top, 6)
            if section.groups.isEmpty {
                Text("No voting groups in this workspace yet.").font(.system(size: 14)).foregroundStyle(Palette.muted)
            }
            ForEach(section.groups) { row in
                Button { open(row.ref) } label: { GroupCard(row: row) }.buttonStyle(.plain)
            }
        }
    }
}

enum GroupsSheet: String, Identifiable {
    case newWorkspace, join, account
    var id: String { rawValue }
}

struct GroupCard: View {
    let row: GroupRow

    var body: some View {
        Card {
            HStack(spacing: 14) {
                Avatar(label: "", seed: row.ref.contextId, size: 46, square: true, symbol: "checklist")
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.latest ?? "No polls yet")
                        .font(Typeface.display(17))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                    Text(subtitle).font(.system(size: 14)).foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .padding(14)
        }
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        guard let polls = row.polls else { return "Voting group" }
        return "\(VoteFormat.count(polls, "poll", "polls")) · \(row.open) open"
    }
}

struct SkeletonCard: View {
    var body: some View {
        Card {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 12).fill(Palette.sunken).frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 140, height: 14)
                    RoundedRectangle(cornerRadius: 4).fill(Palette.sunken).frame(width: 80, height: 10)
                }
                Spacer()
            }
            .padding(14)
        }
        .redacted(reason: .placeholder)
    }
}

/// One name in, one async action out: new workspace, your name.
struct NameSheet: View {
    let title: String
    let placeholder: String
    let action: String
    let note: String
    var initial = ""
    let submit: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: title, action: action, canAct: !name.trimmingCharacters(in: .whitespaces).isEmpty, busy: busy,
                cancel: { dismiss() }, act: run)
            VStack(alignment: .leading, spacing: 12) {
                TextField(placeholder, text: $name)
                    .font(Typeface.display(22))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(run)
                    .padding(.vertical, 8)
                    .onChange(of: name) { value in
                        if value.count > VoteConstants.maxName { name = String(value.prefix(VoteConstants.maxName)) }
                    }
                Rectangle().fill(Palette.hairline).frame(height: 0.5)
                Text(note).font(.system(size: 14)).foregroundStyle(Palette.muted)
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
        .onAppear {
            name = initial
            focused = true
        }
    }

    private func run() {
        guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        error = nil
        Task {
            do {
                try await submit(name)
                Haptics.success()
                dismiss()
            } catch {
                self.error = VoteErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Paste an invitation link somebody sent you.
struct JoinSheet: View {
    let join: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Join with a link", action: "Continue",
                canAct: !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                busy: false, cancel: { dismiss() }, act: run)
            VStack(alignment: .leading, spacing: 12) {
                TextField("Paste an invitation link", text: $link, axis: .vertical)
                    .font(.system(size: 16))
                    .lineLimit(3...6)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
                if let clip = UIPasteboard.general.string, VoteInvitation.parse(clip) != nil, link.isEmpty {
                    Button {
                        link = clip
                    } label: {
                        Label("Paste from clipboard", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Text("Links look like links.calimero.network/com.calimero.mero-vote/join?invitation=…")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private func run() {
        guard VoteInvitation.parse(link) != nil else {
            error = "This isn't a Mero Vote invitation. Check the link and try again."
            Haptics.failure()
            return
        }
        join(link)
    }
}

/// Who you are, and the way out.
struct AccountSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(label: "You", seed: session.account ?? "you", size: 52, symbol: "person")
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Your account").font(Typeface.display(20)).foregroundStyle(Palette.ink)
                            Text(VoteFormat.short(session.account ?? "")).font(.system(size: 14, design: .monospaced))
                                .foregroundStyle(Palette.muted)
                        }
                    }
                    .padding(.vertical, 6)
                } footer: {
                    Text("You set the name others see inside each voting group, from its Members page.")
                }
                Section {
                    DetailsDisclosure(rows: [
                        ("Account", session.account ?? ""),
                        ("Application", session.applicationId ?? ""),
                    ])
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            await session.signOut()
                            dismiss()
                        }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .voteNavigation("Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
