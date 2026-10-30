import MeroKit
import MeroKitUI
import SwiftUI

// Calimero 1.0 sign-in and approvals, shared by the native apps (the same file in each; only
// `CloudStyle.app`, in Theme.swift, differs).
//
// - Cloud: a node URL of the person's cluster (from the cloud.calimero.network console; prefilled
//   from `MeroNodeURL`), then the device's passkey: sign in, or create an account.
// - Development: a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501` by default) with
//   mock attestation allowed (`allowMock`) and a software passkey the SDK keeps for that node.
// - Approvals: releases and upgrades waiting for the person's decision, approved on the node's
//   own consent page in the system browser (an app's session cannot approve anything itself).

/// The colours the shared sign-in and approvals views use, set per app in Theme.swift.
struct CloudStyle {
    var ink: Color
    var muted: Color
    var accent: Color
    var onAccent: Color
    var danger: Color
    var field: Color
    var hairline: Color
}

/// How the app reaches its cluster, from Info.plist.
enum CloudSettings {
    /// A node of the person's Calimero Cloud cluster (`MeroNodeURL`); empty: they enter one.
    static var clusterURL: String? { string("MeroNodeURL") }
    /// The development node the "Development node" field starts with (`MeroDevNodeURL`).
    static var devNodeURL: String { string("MeroDevNodeURL") ?? "http://localhost:2501" }

    static func string(_ key: String) -> String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }
}

/// Sign in with a passkey, create an account, or connect to a development node.
struct CloudSignInPanel: View {
    @EnvironmentObject private var session: MeroAppSession
    let style: CloudStyle
    @State private var clusterURL = CloudSettings.clusterURL ?? ""
    @State private var devNodeURL = CloudSettings.devNodeURL
    @State private var name = ""
    @State private var creating = false
    @State private var showDevelopment = false
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            if let error = session.client.errorMessage {
                Text(error).font(.system(size: 14)).foregroundStyle(style.danger).multilineTextAlignment(.center)
                    .accessibilityIdentifier("signIn.error")
            }
            if CloudSettings.clusterURL == nil {
                field("Cluster URL", text: $clusterURL, placeholder: "https://node.your-cluster.calimero.network")
                    .keyboardType(.URL)
                    .accessibilityIdentifier("signIn.cluster")
            }
            if creating || showDevelopment {
                field("Your name", text: $name, placeholder: "Ada")
                    .textContentType(.name)
                    .accessibilityIdentifier("signIn.name")
            }
            if showDevelopment {
                field("Development node", text: $devNodeURL, placeholder: "http://localhost:2501")
                    .keyboardType(.URL)
                    .accessibilityIdentifier("signIn.devNode")
                primary(title: "Connect", symbol: "server.rack", enabled: !trimmed(devNodeURL).isEmpty) {
                    session.connect(nodeURL: trimmed(devNodeURL), allowMock: true)
                    await session.client.signInOrSignUp(name: trimmed(name).isEmpty ? nil : trimmed(name))
                    session.rebuild()
                }
                .accessibilityIdentifier("signIn.connect")
            } else if creating {
                primary(title: "Create account", symbol: "person.badge.key", enabled: canUseCluster && !trimmed(name).isEmpty) {
                    connectCluster()
                    await session.signUp(name: trimmed(name))
                }
                .accessibilityIdentifier("signIn.create")
            } else {
                primary(title: "Sign in with passkey", symbol: "person.badge.key", enabled: canUseCluster) {
                    connectCluster()
                    await session.signIn()
                }
                .accessibilityIdentifier("signIn.passkey")
            }
            HStack(spacing: 18) {
                if !showDevelopment {
                    link(creating ? "I have an account" : "Create an account") { creating.toggle() }
                }
                link(showDevelopment ? "Use Calimero Cloud" : "Development node") {
                    showDevelopment.toggle()
                    creating = false
                }
            }
            .padding(.top, 2)
            Text(footnote).font(.system(size: 13)).foregroundStyle(style.muted).multilineTextAlignment(.center)
        }
    }

    private var footnote: String {
        showDevelopment
            ? "For a node from `merod local`: its mock attestation is trusted and a test passkey is kept on this phone."
            : "Your passkey stays on this device. Calimero verifies the node before anything is sent."
    }

    private var canUseCluster: Bool { !trimmed(clusterURL).isEmpty }

    private func connectCluster() {
        session.connect(nodeURL: trimmed(clusterURL), allowMock: false)
    }

    private func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func field(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(style.muted)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 16))
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(style.field))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(style.hairline))
        }
    }

    private func primary(title: String, symbol: String, enabled: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            busy = true
            Task {
                await action()
                busy = false
            }
        } label: {
            HStack(spacing: 8) {
                if busy {
                    ProgressView().tint(style.onAccent)
                } else {
                    Image(systemName: symbol)
                    Text(title)
                }
            }
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(style.onAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(style.accent))
            .opacity(enabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!enabled || busy)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(style.ink)
            .disabled(busy)
    }
}

/// Releases and upgrades waiting for the person, per org (and their own apps), each approved on
/// the node's consent page in the system browser.
struct ApprovalsSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @Environment(\.dismiss) private var dismiss
    let style: CloudStyle
    /// The orgs to look in (id, name); `nil`: every org of this app the account is in. The
    /// person's own apps are always included.
    var orgs: [(id: String, name: String)]? = nil
    @State private var sections: [Section] = []
    @State private var loading = true
    @State private var error: String?
    @State private var deciding: String?

    struct Section: Identifiable {
        let id: String
        let title: String
        let scope: ReportScope
        let approvals: PendingApprovals
    }

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                } else if let error {
                    Text(error).foregroundStyle(style.danger)
                } else if sections.allSatisfy({ $0.approvals.releases.isEmpty && $0.approvals.upgrades.isEmpty }) {
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.seal").font(.system(size: 28)).foregroundStyle(style.ink)
                        Text("Nothing is waiting for you.").foregroundStyle(style.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(sections) { section in
                        if !(section.approvals.releases.isEmpty && section.approvals.upgrades.isEmpty) {
                            SwiftUI.Section(section.title) {
                                ForEach(section.approvals.releases, id: \.version) { release in
                                    row(
                                        symbol: "shield.lefthalf.filled", title: "Node release \(release.version)",
                                        detail: release.deadline.map { "Approve before \($0.after)" }
                                            ?? "Runs on \(release.nodes) node\(release.nodes == 1 ? "" : "s")",
                                        actionable: release.actionable, key: "\(section.id)/r/\(release.version)"
                                    ) { returnTo in
                                        releaseConsent(section.scope, version: release.version, returnTo: returnTo)
                                    }
                                }
                                ForEach(section.approvals.upgrades, id: \.app) { upgrade in
                                    row(
                                        symbol: "arrow.up.circle", title: "Update \(upgrade.name ?? upgrade.package)",
                                        detail: "\(upgrade.from) → \(upgrade.to)", actionable: upgrade.actionable,
                                        key: "\(section.id)/u/\(upgrade.app)"
                                    ) { returnTo in
                                        upgradeConsent(app: upgrade.app, toVersion: upgrade.to, returnTo: returnTo)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Approvals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
            .refreshable { await load() }
        }
        .tint(style.ink)
    }

    private func row(
        symbol: String, title: String, detail: String, actionable: Bool, key: String,
        request: @escaping (String) -> ConsentRequest
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(style.ink).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .medium)).foregroundStyle(style.ink)
                Text(actionable ? detail : "Your cluster's operator approves this.")
                    .font(.system(size: 13)).foregroundStyle(style.muted)
            }
            Spacer()
            if actionable {
                if deciding == key {
                    ProgressView()
                } else {
                    Button("Review") {
                        deciding = key
                        Task {
                            do {
                                _ = try await session.requestConsent(request(session.callback.url))
                            } catch {
                                self.error = MeroClient.describe(error)
                            }
                            deciding = nil
                            await load()
                        }
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .buttonStyle(.bordered)
                    .disabled(deciding != nil)
                }
            }
        }
    }

    private func load() async {
        loading = sections.isEmpty
        defer { loading = false }
        var next: [Section] = []
        do {
            next.append(
                Section(
                    id: "account", title: "Your apps", scope: .account, approvals: try await session.pendingApprovals()))
            var orgs = self.orgs ?? []
            if self.orgs == nil, let backend = session.backend {
                orgs = try await backend.listNamespaces().map { ($0.id, $0.name ?? "Organization") }
            }
            for org in orgs {
                let approvals = try await session.pendingApprovals(org: org.id)
                next.append(Section(id: org.id, title: org.name, scope: .org(org.id), approvals: approvals))
            }
            sections = next
            error = nil
        } catch {
            self.error = MeroClient.describe(error)
        }
    }
}
