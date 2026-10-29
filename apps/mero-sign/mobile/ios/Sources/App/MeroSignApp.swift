import MeroKit
import MeroKitUI
import SignCore
import SwiftUI

/// Where sign-in goes, from Info.plist (empty = the SDK's defaults).
enum AppConfig {
    static var callback: CloudCallback { .scheme(string("MeroSignCallbackScheme") ?? "mero-sign") }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            packageName: SignConstants.packageName,
            registryURL: string("MeroRegistryURL"),
            cloudBaseURL: string("MeroCloudBaseURL").flatMap(URL.init(string:)))
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    private static func string(_ key: String) -> String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }
}

@main
struct MeroSignApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: SignConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: "network.calimero.sign")

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
    let hasAdmin: Bool

    init(backend: any MeroAppBackend, admin: (any AdminSurface)?, applicationId: String?) {
        self.backend = backend
        self.admin = BackendSignAdmin(backend: backend, admin: admin)
        hasAdmin = admin != nil
        store = PrivateStore(
            backend: backend, admin: self.admin, applicationId: applicationId, cache: DefaultsPrivateContextCache())
        directory = AgreementDirectory(backend: backend, store: store)
        names = NameDirectory(admin: self.admin)
        inbox = InboxModel(directory: directory)
        agreements = AgreementsModel(directory: directory)
        signatures = SignaturesModel(store: store)
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
                        InboxScreen(model: services.inbox, openInvitation: { invitation.open($0) })
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
        .onReceive(session.client.$admin) { _ in rebuild() }
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
        if let services, builtFor == session.revision, services.hasAdmin == (session.client.admin != nil) { return }
        services = AppServices(backend: backend, admin: session.client.admin, applicationId: session.applicationId)
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
