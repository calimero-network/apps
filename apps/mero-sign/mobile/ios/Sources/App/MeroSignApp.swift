import MeroKit
import MeroKitUI
import SignCore
import SwiftUI

/// Which Calimero 1.0 cluster the app talks to and where the node's consent
/// page returns to, from Info.plist (empty = not set: sign-in asks for a node).
enum AppConfig {
    /// `mero-sign://consent?request_id=…&result=…`.
    static var callback: CloudCallback { .scheme(string("MeroSignCallbackScheme") ?? "mero-sign", path: "consent") }

    /// A node of the cluster (Calimero Cloud's console lists them), the rest of
    /// the cluster for failover, and how far to trust it: production
    /// attestation, or mock attestation for a `merod local` cluster.
    static var config: MeroProviderConfig {
        let allowMock = string("MeroAllowMock").map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false
        return MeroProviderConfig(
            nodeURL: string("MeroNodeURL"),
            nodes: (string("MeroNodes") ?? "").split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty },
            policy: allowMock ? .development : .production, packageName: SignConstants.packageName,
            packageVersion: string("MeroPackageVersion"))
    }

    private static func string(_ key: String) -> String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }
}

@main
struct MeroSignApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: SignConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: "network.calimero.sign")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Palette.ink)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Everything a signed-in screen needs, rebuilt when the session changes.
@MainActor
final class AppServices: ObservableObject {
    let backend: any MeroAppBackend
    let admin: any SignAdmin
    let store: PrivateStore
    let directory: AgreementDirectory
    let names: NameDirectory
    let inbox: InboxModel
    let agreements: AgreementsModel
    let signatures: SignaturesModel
    let approvals: ApprovalsModel

    init(session: MeroAppSession, backend: any MeroAppBackend) {
        self.backend = backend
        self.admin = BackendSignAdmin(backend: backend, client: (backend as? CalimeroAppBackend)?.client)
        let applicationId = session.applicationId
        approvals = ApprovalsModel(session: session)
        store = PrivateStore(
            backend: backend, admin: self.admin, applicationId: applicationId, cache: DefaultsPrivateContextCache())
        directory = AgreementDirectory(backend: backend, store: store)
        names = NameDirectory(admin: self.admin)
        inbox = InboxModel(directory: directory)
        agreements = AgreementsModel(directory: directory)
        signatures = SignaturesModel(store: store)
    }

    /// What waits for approval in the account and in each of its workspaces.
    func refreshApprovals() async {
        let workspaces = (try? await backend.listNamespaces().map(\.id)) ?? []
        await approvals.refresh(orgs: workspaces)
    }
}

/// A document to show: the agreement it is in and its id.
struct DocumentRoute: Hashable {
    let agreement: AgreementRef
    let documentId: String
}

enum AppTab: Hashable { case inbox, agreements, signatures }

/// Signed out: the sign-in screen. Signed in: Inbox, Agreements, Signatures.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var invitation = InvitationModel()
    @State private var services: AppServices?
    @State private var builtFor: Int?
    @State private var tab: AppTab = .inbox
    @State private var inboxPath = NavigationPath()
    @State private var agreementsPath = NavigationPath()

    var body: some View {
        Group {
            if session.isRestoring && session.backend == nil {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            } else if let services {
                TabView(selection: $tab) {
                    NavigationStack(path: $inboxPath) {
                        InboxScreen(
                            model: services.inbox, approvals: services.approvals,
                            refreshApprovals: { await services.refreshApprovals() },
                            openInvitation: { invitation.open($0) })
                            .withSignDestinations(services)
                    }
                    .tabItem { Label("Inbox", systemImage: "tray.full") }
                    .tag(AppTab.inbox)

                    NavigationStack(path: $agreementsPath) {
                        AgreementsScreen(
                            model: services.agreements, openInvitation: { invitation.open($0) },
                            push: { agreementsPath.append($0) })
                            .withSignDestinations(services)
                    }
                    .tabItem { Label("Agreements", systemImage: "folder") }
                    .tag(AppTab.agreements)

                    NavigationStack {
                        SignaturesScreen(model: services.signatures)
                    }
                    .tabItem { Label("Signatures", systemImage: "signature") }
                    .tag(AppTab.signatures)
                }
                .environmentObject(services)
                .id(session.revision)
            } else if session.backend != nil {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            } else {
                SignInView(invitedTo: invitedTitle)
            }
        }
        .task(id: session.revision) { rebuild() }
        .onChange(of: session.pendingInvitation) { raw in
            guard let raw else { return }
            invitation.open(raw)
            session.dismissPendingInvitation()
        }
        .sheet(isPresented: invitationShown) {
            InvitationSheet(model: invitation) { destination in
                tab = .inbox
                inboxPath = NavigationPath()
                Task { await services?.inbox.load() }
                if let agreement = destination.agreement { inboxPath.append(agreement) }
            }
            .environmentObject(session)
            .presentationDetents([.medium])
            .interactiveDismissDisabled(isJoining)
        }
    }

    private func rebuild() {
        guard let backend = session.backend else {
            services = nil
            builtFor = nil
            return
        }
        if services != nil, builtFor == session.revision { return }
        services = AppServices(session: session, backend: backend)
        builtFor = session.revision
    }

    private var invitedTitle: String? {
        if case .confirm(let title) = invitation.stage { return title }
        return nil
    }

    private var isJoining: Bool {
        if case .joining = invitation.stage { return true }
        return false
    }

    private var invitationShown: Binding<Bool> {
        Binding(
            get: { invitation.stage != .idle && services != nil },
            set: { if !$0 { invitation.reset() } })
    }
}

extension View {
    /// The agreement and document screens, pushed from any tab.
    func withSignDestinations(_ services: AppServices) -> some View {
        navigationDestination(for: AgreementRef.self) { agreement in
            AgreementScreen(
                model: AgreementModel(directory: services.directory, names: services.names, agreement: agreement))
        }
        .navigationDestination(for: DocumentRoute.self) { route in
            DocumentScreen(
                model: DocumentModel(
                    directory: services.directory, names: services.names, agreement: route.agreement,
                    documentId: route.documentId,
                    initial: services.inbox.entries.first {
                        $0.agreement.contextId == route.agreement.contextId && $0.document.id == route.documentId
                    }))
        }
    }
}
