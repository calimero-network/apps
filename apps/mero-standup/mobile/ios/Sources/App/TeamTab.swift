import StandupCore
import SwiftUI
import UIKit

/// The team itself: its name, invitations, your name, its people, and leaving.
struct TeamTab: View {
    @ObservedObject var team: TeamModel
    let onSwitchTeam: () -> Void
    let onSignOut: () -> Void

    @State private var renamingTeam = false
    @State private var renamingMe = false
    @State private var nameDraft = ""
    @State private var link: String?
    @State private var creating = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        nameDraft = team.teamName
                        renamingTeam = true
                    } label: {
                        HStack {
                            Text(team.teamName.isEmpty ? "Name this team" : team.teamName)
                                .foregroundStyle(team.teamName.isEmpty ? Palette.ink2 : Palette.ink)
                            Spacer()
                            Image(systemName: "pencil").foregroundStyle(Palette.ink2)
                        }
                    }
                } header: {
                    Text("Team")
                }

                Section {
                    Text("One link. Whoever opens it joins this team and sees its standups and decisions; nobody without one can.")
                        .font(.subheadline).foregroundStyle(Palette.ink2)
                    Button(action: createLink) {
                        Label(creating ? "Creating…" : link == nil ? "Create invite link" : "Create another", systemImage: "link")
                    }
                    .disabled(creating)
                    .accessibilityIdentifier("team.invite")
                    if let link {
                        Text(link).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).foregroundStyle(Palette.ink2)
                            .textSelection(.enabled)
                        HStack(spacing: 10) {
                            ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
                                .buttonStyle(SecondaryButtonStyle())
                            Button {
                                UIPasteboard.general.string = link
                                Haptics.success()
                                copied = true
                            } label: {
                                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                        .listRowSeparator(.hidden)
                    }
                    if let error { ErrorLine(message: error) }
                } header: {
                    Text("Invite")
                }

                Section {
                    Button {
                        nameDraft = team.myName
                        renamingMe = true
                    } label: {
                        HStack(spacing: 12) {
                            if let me = team.me { Avatar(account: me, name: team.myName, size: 30) }
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Your name").font(.subheadline).foregroundStyle(Palette.ink)
                                Text(team.myName.isEmpty ? "Not set" : team.myName).font(.footnote).foregroundStyle(Palette.ink2)
                            }
                            Spacer()
                            Image(systemName: "pencil").foregroundStyle(Palette.ink2)
                        }
                    }
                } header: {
                    Text("You")
                }

                if !team.members.isEmpty {
                    Section {
                        ForEach(team.members, id: \.account) { member in
                            HStack(spacing: 12) {
                                Avatar(account: member.account, name: member.name, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(team.name(of: member.account, member.name)).font(.subheadline).foregroundStyle(Palette.ink)
                                    Text(member.lastDay.isEmpty ? "Hasn't posted" : "Last posted \(Days.describe(member.lastDay).lowercased())")
                                        .font(.footnote).foregroundStyle(Palette.ink2)
                                }
                            }
                        }
                    } header: {
                        Text("People")
                    }
                }

                Section {
                    Button(action: onSwitchTeam) {
                        Label("Switch team", systemImage: "arrow.left.arrow.right").foregroundStyle(Palette.ink)
                    }
                    Button(role: .destructive, action: onSignOut) {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(Palette.danger)
                    }
                }

                Section {
                    DisclosureGroup {
                        DetailRow(label: "Team (context) id", value: team.contextId)
                        DetailRow(label: "Namespace id", value: team.namespaceId)
                        if let me = team.me { DetailRow(label: "Your account", value: me) }
                    } label: {
                        Label("Details", systemImage: "info.circle").foregroundStyle(Palette.ink2)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Team")
            .refreshable { await team.load() }
            .alert("Name this team", isPresented: $renamingTeam) {
                TextField("Team name", text: $nameDraft)
                Button("Save") { save { try await team.renameTeam(String(nameDraft.prefix(Limits.teamName))) } }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Your name", isPresented: $renamingMe) {
                TextField("Your name", text: $nameDraft)
                Button("Save") { save { try await team.setMyName(String(nameDraft.prefix(Limits.name))) } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("It shows on everything you post.")
            }
        }
    }

    private func createLink() {
        creating = true
        copied = false
        Task {
            do {
                link = try await team.inviteLink()
                error = nil
                Haptics.success()
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
            }
            creating = false
        }
    }

    private func save(_ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                error = nil
            } catch {
                self.error = StandupCore.ErrorText.describe(error)
            }
        }
    }
}
