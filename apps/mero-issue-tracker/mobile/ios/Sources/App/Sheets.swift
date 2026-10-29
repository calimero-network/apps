import IssueTrackerCore
import MeroKitUI
import SwiftUI
import UIKit

/// A titled text area inside a sheet's form.
struct SectionField: View {
    let n: Int?
    let title: String
    let placeholder: String
    @Binding var text: String
    var mono = false
    var id = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let n {
                    Text("\(n)").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink)
                        .frame(width: 20, height: 20).background(Theme.lime, in: Circle())
                }
                Text(title.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.5).foregroundStyle(Theme.text3)
            }
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(3...10)
                .font(mono ? .system(size: 14, design: .monospaced) : .system(size: 15))
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
                .accessibilityIdentifier(id)
        }
    }
}

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
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy).accessibilityIdentifier("sheet.cancel")
                }
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
                .accessibilityIdentifier("sheet.action")
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
        .interactiveDismissDisabled(busy)
    }
}

struct NewIssueSheet: View {
    @ObservedObject var issues: IssuesModel
    let repoName: String?
    @State private var draft = IssueDraft()
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(title: "New issue", action: "Create issue", canSubmit: draft.isValid, busy: busy, error: error, submit: submit) {
            if let repoName {
                Label(repoName, systemImage: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text2)
            }
            TextField("Issue title", text: $draft.title, axis: .vertical)
                .accessibilityIdentifier("newIssue.title")
                .font(Theme.heading(20))
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
            SectionField(
                n: 1, title: "Summary", placeholder: "What is broken, in one paragraph", text: $draft.summary,
                id: "newIssue.summary")
            SectionField(
                n: 2, title: "Impact", placeholder: "Who/what does it affect, why does severity matter", text: $draft.impact,
                id: "newIssue.impact")
            SectionField(
                n: 3, title: "Repro", placeholder: "Numbered steps and/or paste logs", text: $draft.repro, mono: true,
                id: "newIssue.repro")
            SectionField(
                n: 4, title: "Resolution criteria", placeholder: "What does fixed mean? The agent will validate against this",
                text: $draft.resolution, id: "newIssue.resolution")
            VStack(alignment: .leading, spacing: 8) {
                Text("PRIORITY").font(.system(size: 11, weight: .bold)).tracking(0.5).foregroundStyle(Theme.text3)
                Picker("Priority", selection: $draft.priority) {
                    ForEach(Tracker.priorities, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("LABELS").font(.system(size: 11, weight: .bold)).tracking(0.5).foregroundStyle(Theme.text3)
                TextField("sync, crdt…", text: $draft.labels)
                    .accessibilityIdentifier("newIssue.labels")
                    .textInputAutocapitalization(.never)
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
            }
            Text("All four sections are required. Issues filed through MCP follow the same format.")
                .font(.system(size: 13)).foregroundStyle(Theme.text3)
        }
    }

    private func submit() {
        Theme.haptic()
        busy = true
        error = nil
        Task {
            do {
                try await issues.create(draft)
                Theme.success()
                dismiss()
            } catch {
                self.error = TrackerFormat.errorText(error)
            }
            busy = false
        }
    }
}

/// Edit the four sections (the contract keeps the title as filed).
struct EditSectionsSheet: View {
    @State private var draft: SectionsDraft
    let save: (SectionsDraft) async -> String?
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(issue: IssueView, save: @escaping (SectionsDraft) async -> String?) {
        _draft = State(initialValue: SectionsDraft(issue))
        self.save = save
    }

    var body: some View {
        SheetScaffold(title: "Edit issue", action: "Save", canSubmit: draft.isValid, busy: busy, error: error) {
            Theme.haptic()
            busy = true
            Task {
                if let failure = await save(draft) {
                    error = failure
                } else {
                    dismiss()
                }
                busy = false
            }
        } content: {
            SectionField(n: 1, title: "Summary", placeholder: "What is broken, in one paragraph", text: $draft.summary)
            SectionField(n: 2, title: "Impact", placeholder: "Who/what does it affect, why does severity matter", text: $draft.impact)
            SectionField(n: 3, title: "Repro", placeholder: "Numbered steps and/or paste logs", text: $draft.repro, mono: true)
            SectionField(
                n: 4, title: "Resolution criteria", placeholder: "What does fixed mean? The agent will validate against this",
                text: $draft.resolution)
        }
    }
}

struct FilterSheet: View {
    @ObservedObject var issues: IssuesModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Status", selection: $issues.filters.status) {
                    Text("All statuses").tag("")
                    ForEach(Tracker.statuses, id: \.self) { Label($0, systemImage: StatusIcon.name($0)).tag($0) }
                }
                Picker("Priority", selection: $issues.filters.priority) {
                    Text("All priorities").tag("")
                    ForEach(Tracker.priorities, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .accessibilityIdentifier("filters.priority")
                Section("Assignee") {
                    TextField("Filter by assignee…", text: $issues.filters.assignee).textInputAutocapitalization(.words)
                    suggestions(issues.knownAssignees, \.assignee)
                }
                Section("Label") {
                    TextField("Filter by label…", text: $issues.filters.label).textInputAutocapitalization(.never)
                    suggestions(issues.knownLabels, \.label)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") { issues.clearFilters() }.disabled(!issues.filters.isActive)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold).accessibilityIdentifier("sheet.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func suggestions(_ values: [String], _ key: WritableKeyPath<IssueFilters, String>) -> some View {
        if !values.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(values.enumerated()), id: \.element) { i, value in
                        Button(value) { issues.filters[keyPath: key] = value }
                            .accessibilityIdentifier("filters.\(key == \IssueFilters.label ? "label" : "assignee").\(i)")
                            .font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(issues.filters[keyPath: key] == value ? Theme.lime : Theme.sunken, in: Capsule())
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// One text field and a primary action: New workspace, Repository URL.
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
                    self.error = TrackerFormat.errorText(error)
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

struct AddRepoSheet: View {
    @ObservedObject var workspace: WorkspaceModel
    let done: () -> Void
    @State private var name = ""
    @State private var url = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(
            title: "Add a repository", action: "Add repository", canSubmit: !name.trimmingCharacters(in: .whitespaces).isEmpty,
            busy: busy, error: error
        ) {
            Theme.haptic()
            busy = true
            error = nil
            Task {
                do {
                    try await workspace.addRepo(name: name, url: url)
                    Theme.success()
                    done()
                    dismiss()
                } catch {
                    self.error = TrackerFormat.errorText(error)
                }
                busy = false
            }
        } content: {
            Text("Repos are tracked separately. Give it a name and its GitHub URL.")
                .font(.system(size: 15)).foregroundStyle(Theme.text2)
            LabeledField(label: "Repo name", placeholder: "e.g. core", text: $name)
            LabeledField(label: "GitHub URL", placeholder: "https://github.com/owner/repo", text: $url, keyboard: .URL)
        }
        .presentationDetents([.medium, .large])
    }
}

struct InviteSheet: View {
    @ObservedObject var workspace: WorkspaceModel
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
                Text("Generate an invite link and share it with anyone you want to join this workspace.")
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
                    Text("Whoever opens the link is asked to join this workspace.").font(.system(size: 13)).foregroundStyle(Theme.text3)
                } else {
                    Button {
                        Theme.haptic()
                        busy = true
                        error = nil
                        Task {
                            do { link = try await workspace.inviteLink() } catch { self.error = TrackerFormat.errorText(error) }
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
                    .accessibilityIdentifier("invite.generate")
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
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done") }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// An invitation link arrived: say which workspace, and join on confirmation.
struct JoinInvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    let link: String
    @Binding var justJoined: String?
    @State private var busy = false
    @State private var error: String?

    private var invitation: TrackerInvitation? { TrackerInvitation.parse(link) }

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "person.2").font(.system(size: 26, weight: .medium)).foregroundStyle(Theme.ink)
                .frame(width: 60, height: 60).background(Theme.lime, in: RoundedRectangle(cornerRadius: 18))
                .padding(.top, 28)
            if let invitation {
                Text("Join \(invitation.workspaceName ?? "this workspace")?").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text("You were invited to a workspace on Mero Issue Tracker. Joining lets you see and triage its issues.")
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
                                backend: backend, applicationId: session.applicationId, store: DefaultsTrackerStore())
                            try await model.join(invitation)
                            justJoined = invitation.namespaceId
                            await session.didJoinNamespace()
                            Theme.success()
                            session.dismissPendingInvitation()
                        } catch {
                            self.error = TrackerFormat.errorText(error)
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
