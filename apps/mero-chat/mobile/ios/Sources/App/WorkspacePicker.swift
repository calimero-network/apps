import MeroKit
import SwiftUI

/// The web app's workspace entry dialog (`NamespaceEntryPopup.tsx`): pick a
/// workspace, name yourself, create one, or join one from an invitation link.
struct WorkspacePicker: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var model: WorkspacesModel
    /// A workspace was chosen and the account has a name to use in it.
    let onEnter: (Workspace) -> Void

    enum Step: Equatable {
        case select
        case name(Workspace)
        case create
        case join(prefill: String)
    }

    @State private var step: Step = .select
    @State private var selectedId: String?
    @State private var text = ""
    @State private var working = false

    var body: some View {
        ZStack {
            GroundBackground()
            Theme.scrim.ignoresSafeArea()
            ScrollView {
                card
                    .padding(.horizontal, 20)
                    .padding(.vertical, 60)
                    .frame(maxWidth: 460)
                    .frame(maxWidth: .infinity)
            }
        }
        .task { await model.load() }
        .onChange(of: session.pendingInvitation) { link in
            guard let link else { return }
            session.pendingInvitation = nil
            go(.join(prefill: link))
        }
        .onAppear {
            if let link = session.pendingInvitation {
                session.pendingInvitation = nil
                go(.join(prefill: link))
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .padding(28)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.surfaceSolid)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.ink(8), lineWidth: 1))
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.35), radius: 32, y: 24)
        )
    }

    @ViewBuilder private var content: some View {
        if let error = model.errorText {
            Banner(kind: .error, text: error) { model.errorText = nil }.padding(.bottom, 16)
        }
        if let notice = model.notice {
            Banner(kind: .notice, text: notice) { model.notice = nil }.padding(.bottom, 16)
        }
        switch step {
        case .select: selectStep
        case .name(let workspace): nameStep(workspace)
        case .create: createStep
        case .join: joinStep
        }
    }

    // MARK: Select

    @ViewBuilder private var selectStep: some View {
        if model.isLoading && model.workspaces.isEmpty {
            VStack(spacing: 14) {
                ProgressView().tint(Theme.accent).scaleEffect(1.2)
                Text("Connecting to your relay…").font(Theme.font(14)).foregroundStyle(Theme.ink(38))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        } else if !model.hasRelay {
            title("Welcome to MeroChat", sub: "No relay serves this account yet. Join a workspace from an invitation link to get one.")
            Button("Join with an invitation") { go(.join(prefill: "")) }
                .buttonStyle(InkButtonStyle())
            footer
        } else if model.workspaces.isEmpty {
            title("Welcome to MeroChat", sub: "No servers found for your account yet. Create one to get started.")
            Button("Create workspace") { go(.create) }
                .buttonStyle(InkButtonStyle())
                .accessibilityIdentifier("createWorkspaceButton")
            joinLink
            footer
        } else {
            title("Select workspace", sub: "Pick the workspace you want to join.")
            Theme.label("Server", size: 10.9, opacity: 35).padding(.bottom, 8)
            VStack(spacing: 6) {
                ForEach(model.workspaces) { workspace in
                    workspaceRow(workspace)
                }
            }
            .padding(.bottom, 20)
            Button("Continue") {
                guard let workspace = model.workspaces.first(where: { $0.id == selectedId }) ?? model.workspaces.first
                else { return }
                enter(workspace)
            }
            .buttonStyle(InkButtonStyle())
            .accessibilityIdentifier("continueButton")
            HStack {
                Button("+ Create new workspace") { go(.create) }
                Spacer()
                Button("Join with a link") { go(.join(prefill: "")) }
            }
            .font(Theme.font(12.5, .semibold))
            .foregroundStyle(Theme.accent)
            .padding(.top, 14)
            footer
        }
    }

    private func workspaceRow(_ workspace: Workspace) -> some View {
        let selected = (selectedId ?? model.workspaces.first?.id) == workspace.id
        return Button {
            selectedId = workspace.id
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "square.grid.2x2").font(.system(size: 13))
                Text(workspace.name).font(Theme.font(14, selected ? .semibold : .regular)).lineLimit(1)
                Spacer()
                if selected { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)) }
            }
            .foregroundStyle(selected ? Theme.accent : Theme.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 42)
            .background(RoundedRectangle(cornerRadius: 10).fill(selected ? Theme.accent(8) : Theme.accent(4)))
            .overlay(
                RoundedRectangle(cornerRadius: 10).stroke(selected ? Theme.accent(40) : Theme.accent(22), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Copy workspace id") { UIPasteboard.general.string = workspace.id }
        }
    }

    // MARK: Name

    @ViewBuilder private func nameStep(_ workspace: Workspace) -> some View {
        title("Join \(workspace.name)", sub: "Choose a display name to use in this server.")
        Theme.label("Your name", size: 10.9, opacity: 35).padding(.bottom, 8)
        TextField("e.g. Alice", text: $text)
            .textFieldStyle(ChatFieldStyle())
            .textInputAutocapitalization(.words)
            .submitLabel(.go)
            .onSubmit { saveName(workspace) }
            .padding(.bottom, 20)
            .accessibilityIdentifier("displayNameField")
        Button("Join chat") { saveName(workspace) }
            .buttonStyle(InkButtonStyle())
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        backButton
    }

    private func saveName(_ workspace: Workspace) {
        let name = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        session.displayName = String(name.prefix(50))
        onEnter(workspace)
    }

    // MARK: Create

    @ViewBuilder private var createStep: some View {
        title("Create workspace", sub: "Give your server a name to get started.")
        Theme.label("Server name", size: 10.9, opacity: 35).padding(.bottom, 8)
        TextField("e.g. My Team", text: $text)
            .textFieldStyle(ChatFieldStyle())
            .submitLabel(.done)
            .accessibilityIdentifier("workspaceNameField")
        Group {
            if text.utf8.count > ChatConstants.maxNameBytes {
                Text("Name must be 64 characters or fewer (\(text.utf8.count)/64)")
            } else if model.workspaces.contains(where: {
                $0.name.caseInsensitiveCompare(text.trimmingCharacters(in: .whitespaces)) == .orderedSame
            }) {
                Text("A workspace with this name already exists")
            }
        }
        .font(Theme.font(12))
        .foregroundStyle(Theme.badInk)
        .padding(.top, 6)
        Button {
            Task {
                working = true
                let created = await model.create(name: text)
                working = false
                if created {
                    text = ""
                    go(.select)
                }
            }
        } label: {
            HStack(spacing: 8) {
                if working { ProgressView().tint(Theme.onInk) }
                Text(working ? "Creating…" : "Create")
            }
        }
        .buttonStyle(InkButtonStyle())
        .disabled(working || text.trimmingCharacters(in: .whitespaces).isEmpty || text.utf8.count > 64)
        .padding(.top, 20)
        .accessibilityIdentifier("createButton")
        backButton
    }

    // MARK: Join

    @ViewBuilder private var joinStep: some View {
        title("Join a workspace", sub: "Paste the invitation link someone shared from Mero Chat on the web, desktop or a phone.")
        Theme.label("Invitation link", size: 10.9, opacity: 35).padding(.bottom, 8)
        TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
            .lineLimit(2...5)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textFieldStyle(ChatFieldStyle())
            .accessibilityIdentifier("joinLinkField")
        Button {
            Task {
                working = true
                let joined = await model.join(invitation: text) != nil
                if joined {
                    await session.didJoinWorkspace()
                    await model.load()
                }
                working = false
                if joined {
                    text = ""
                    go(.select)
                }
            }
        } label: {
            HStack(spacing: 8) {
                if working { ProgressView().tint(Theme.onInk) }
                Text(working ? "Joining…" : "Join")
            }
        }
        .buttonStyle(InkButtonStyle())
        .disabled(working || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .padding(.top, 20)
        backButton
    }

    // MARK: Pieces

    private func title(_ title: String, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(Theme.font(20, .bold)).tracking(-0.4).foregroundStyle(Theme.ink)
            Text(sub).font(Theme.font(13)).foregroundStyle(Theme.ink(38)).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 24)
    }

    private var joinLink: some View {
        Button {
            go(.join(prefill: ""))
        } label: {
            Text("To join someone else's workspace, open the invitation link they sent you, or paste it here.")
                .font(Theme.font(12))
                .foregroundStyle(Theme.ink(38))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(.top, 16)
    }

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 20)
            Button {
                Task { await session.signOut() }
            } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .buttonStyle(DestructiveButtonStyle(fullWidth: true))
            .accessibilityIdentifier("pickerSignOutButton")
        }
    }

    private var backButton: some View {
        Button("← Back") { go(.select) }
            .buttonStyle(SecondaryButtonStyle())
            .padding(.top, 10)
    }

    private func go(_ next: Step) {
        model.errorText = nil
        if case .join(let prefill) = next { text = prefill } else if next != .select { text = "" }
        if case .name = next { text = session.displayName }
        step = next
    }

    private func enter(_ workspace: Workspace) {
        if session.displayName.trimmingCharacters(in: .whitespaces).isEmpty {
            go(.name(workspace))
        } else {
            onEnter(workspace)
        }
    }
}
