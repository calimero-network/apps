import SheetsCore
import MeroKitUI
import SwiftUI
import UIKit

/// Sheet chrome: title bar with Cancel, a scrolling body, a pinned primary button.
struct SheetScaffold<Body: View>: View {
    let title: String
    let action: String
    let canSubmit: Bool
    let busy: Bool
    let error: String?
    let submit: () -> Void
    @ViewBuilder let content: () -> Body
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    content()
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 14)).foregroundStyle(Theme.danger)
                    }
                }
                .padding(Theme.gutter)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if busy { ProgressView().tint(Theme.ink) }
                        Text(action)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit || busy)
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
        .interactiveDismissDisabled(busy)
    }
}

/// One text field and a primary action: New workspace, New spreadsheet.
struct NameSheet: View {
    let title: String
    let message: String
    let field: String
    let placeholder: String
    let action: String
    var initial = ""
    var allowsEmpty = false
    var keyboard: UIKeyboardType = .default
    let submit: (String) async throws -> Void

    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(
            title: title, action: action, canSubmit: allowsEmpty || !text.trimmingCharacters(in: .whitespaces).isEmpty,
            busy: busy, error: error
        ) {
            Theme.haptic()
            busy = true
            error = nil
            Task {
                do {
                    try await submit(text)
                    Theme.success()
                    dismiss()
                } catch {
                    self.error = SheetsFormat.errorText(error)
                }
                busy = false
            }
        } content: {
            Text(message).font(.system(size: 15)).foregroundStyle(Theme.text2)
            LabeledField(label: field, placeholder: placeholder, text: $text, keyboard: keyboard).focused($focused)
        }
        .presentationDetents([.medium])
        .onAppear {
            text = initial
            focused = true
        }
    }
}

struct LabeledField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(keyboard == .URL ? .never : .sentences)
                .autocorrectionDisabled(keyboard == .URL)
                .font(.system(size: 16))
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
        }
    }
}

struct InviteSheet: View {
    @ObservedObject var workspace: WorkspaceModel
    /// The spreadsheet open when Invite was pressed: opened for whoever joins.
    var spreadsheet: SpreadsheetItem?
    @State private var link: String?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "person.badge.plus").font(.system(size: 24, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 52, height: 52).background(Theme.lime.opacity(0.4), in: RoundedRectangle(cornerRadius: 16))
                Text(
                    "Generate an invite link and share it with anyone you want to join this workspace. "
                        + "They get every spreadsheet in it.")
                    .font(.system(size: 15)).foregroundStyle(Theme.text2)
                if let link {
                    Text(link).font(Theme.mono).foregroundStyle(Theme.text2).lineLimit(4).textSelection(.enabled)
                        .card(padding: 12)
                    ShareLink(item: URL(string: link) ?? URL(string: "https://links.calimero.network")!) {
                        Label("Share invite link", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = link
                        Theme.success()
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy invite link", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Text(
                        spreadsheet.map { "Whoever opens the link is asked to join this workspace, then lands in \($0.name)." }
                            ?? "Whoever opens the link is asked to join this workspace.").font(.system(size: 13)).foregroundStyle(Theme.text3)
                } else {
                    Button {
                        Theme.haptic()
                        busy = true
                        error = nil
                        Task {
                            do { link = try await workspace.inviteLink(spreadsheet: spreadsheet) } catch { self.error = SheetsFormat.errorText(error) }
                            busy = false
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(Theme.ink) }
                            Text("Generate invite link")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 14)).foregroundStyle(Theme.danger)
                }
                Spacer()
            }
            .padding(Theme.gutter)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle("Invite to workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// An invitation link arrived: say which workspace, and join on confirmation.
struct JoinInvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    let link: String
    @Binding var justJoined: JoinedWorkspace?
    @State private var busy = false
    @State private var error: String?

    private var invitation: SheetsInvitation? { SheetsInvitation.parse(link) }

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "person.2").font(.system(size: 26, weight: .medium)).foregroundStyle(Theme.ink)
                .frame(width: 60, height: 60).background(Theme.lime, in: RoundedRectangle(cornerRadius: 18))
                .padding(.top, 28)
            if let invitation {
                Text("Join \(invitation.workspaceName ?? "this workspace")?").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text(
                    invitation.spreadsheetName.map { "You were invited to a workspace on Mero Sheets, to open \($0). Joining lets you see and edit its spreadsheets." }
                        ?? "You were invited to a workspace on Mero Sheets. Joining lets you see and edit its spreadsheets.")
                    .font(.system(size: 15)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
            } else {
                Text("This invitation cannot be read").font(Theme.heading(20)).foregroundStyle(Theme.ink)
                Text("Ask for a new invite link.").font(.system(size: 15)).foregroundStyle(Theme.text2)
            }
            if let error {
                Text(error).font(.system(size: 14)).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
            }
            Spacer()
            if let invitation, let backend = session.backend {
                Button {
                    Theme.haptic()
                    busy = true
                    error = nil
                    Task {
                        do {
                            let model = WorkspaceModel(
                                backend: backend, applicationId: session.applicationId, store: DefaultsSheetsStore())
                            try await model.join(invitation)
                            justJoined = JoinedWorkspace(namespaceId: invitation.namespaceId, contextId: invitation.contextId)
                            await session.didJoinNamespace()
                            Theme.success()
                            session.dismissPendingInvitation()
                        } catch {
                            self.error = SheetsFormat.errorText(error)
                        }
                        busy = false
                    }
                } label: {
                    HStack(spacing: 8) {
                        if busy { ProgressView().tint(Theme.ink) }
                        Text(busy ? "Joining…" : "Join workspace")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
            }
            Button("Not now") { session.dismissPendingInvitation() }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
        }
        .padding(Theme.gutter)
        .background(Theme.ground.ignoresSafeArea())
        .presentationDetents([.medium])
        .interactiveDismissDisabled(busy)
    }
}

/// Change one cell's plain value. Formulas stay on the web; the node computes.
struct EditValueSheet: View {
    @ObservedObject var model: SpreadsheetModel
    let pos: GridPos
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(title: "Edit \(pos.label)", action: "Save", canSubmit: !busy, busy: busy, error: error) {
            Theme.haptic()
            busy = true
            error = nil
            Task {
                do {
                    try await model.setValue(text, at: pos)
                    Theme.success()
                    dismiss()
                } catch {
                    self.error = SheetsFormat.errorText(error)
                }
                busy = false
            }
        } content: {
            VStack(alignment: .leading, spacing: 7) {
                Text("Value").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
                TextField("Empty", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 17, design: .monospaced))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($focused)
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
            }
            Label(
                "Type a number, a date or text. Leave it empty to clear the cell. Formulas are written in the web app.",
                systemImage: "info.circle"
            )
            .font(.system(size: 13)).foregroundStyle(Theme.text3)
        }
        .presentationDetents([.medium])
        .onAppear {
            text = model.cell(at: pos)?.raw ?? ""
            focused = true
        }
    }
}
