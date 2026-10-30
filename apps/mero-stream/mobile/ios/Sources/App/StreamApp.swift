import MeroKit
import MeroKitUI
import StreamCore
import SwiftUI

@main
struct StreamApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: AppConfig.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .tint(Palette.ink)
                .preferredColorScheme(.light)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { Task { await session.handle(url) } }
                }
        }
    }
}

/// Where the app is: the stream list, a stream's rooms, and the call on top.
@MainActor
final class Navigator: ObservableObject {
    @Published var path: [StreamSummary] = []
    /// The call on screen.
    @Published var call: CallTarget?
    /// A room an invitation link asked to open, entered once its stream's rooms load.
    @Published var autoEnter: RoomSummary?
}

/// A room being called in.
struct CallTarget: Identifiable, Hashable {
    let stream: StreamSummary
    let room: RoomSummary
    let contextId: String
    var id: String { contextId }
}

/// Signed out: the sign-in screen. Signed in: streams, rooms, and the call.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var nav = Navigator()
    @AppStorage("displayName") private var displayName = ""

    var body: some View {
        Group {
            if let backend = session.backend {
                NavigationStack(path: $nav.path) {
                    StreamsView(session: session, backend: backend, onSignOut: signOut)
                        .navigationDestination(for: StreamSummary.self) { stream in
                            RoomsView(stream: stream, backend: backend, applicationId: session.applicationId)
                        }
                }
                .id(session.revision)
                .environmentObject(nav)
                .fullScreenCover(item: $nav.call) { target in
                    CallView(
                        target: target, backend: backend, channel: mediaChannel(), name: displayName,
                        onName: { displayName = $0 }
                    )
                }
                .sheet(
                    isPresented: Binding(
                        get: { session.pendingInvitation != nil },
                        set: { if !$0 { session.dismissPendingInvitation() } })
                ) {
                    if let raw = session.pendingInvitation {
                        InvitationSheet(raw: raw, backend: backend) { landing in
                            session.dismissPendingInvitation()
                            Task { await session.didJoinNamespace() }
                            land(landing)
                        }
                    }
                }
            } else {
                SignInView(client: session.client)
            }
        }
    }

    /// The call's media channel: the room's presence on the cluster.
    private func mediaChannel() -> (any MediaChannel)? {
        guard let client = session.client.cloud else { return nil }
        return CalimeroMediaChannel(client: client, account: session.account)
    }

    private func land(_ landing: InvitationLanding) {
        switch landing {
        case .stream(let stream):
            nav.path = [stream]
        case .room(let stream, let room):
            nav.autoEnter = room
            nav.path = [stream]
        }
    }

    private func signOut() {
        nav.call = nil
        nav.path = []
        Task { await session.signOut() }
    }
}

/// "Join this stream?" for an invitation link the system opened.
struct InvitationSheet: View {
    let raw: String
    let onJoined: (InvitationLanding) -> Void
    @StateObject private var model: StreamsModel
    @Environment(\.dismiss) private var dismiss
    private let invitation: StreamInvitation?

    init(raw: String, backend: any MeroAppBackend, onJoined: @escaping (InvitationLanding) -> Void) {
        self.raw = raw
        self.onJoined = onJoined
        self.invitation = StreamInvitation.parse(raw)
        _model = StateObject(wrappedValue: StreamsModel(backend: backend))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            RowIcon(symbol: invitation?.opensRoom == true ? "video" : "square.stack.3d.up")
            if let invitation {
                Text(invitation.opensRoom ? "Join this call?" : "Join this stream?")
                    .font(Typeface.display(26)).foregroundStyle(Palette.ink)
                Text(summary(invitation)).font(.system(size: 16)).foregroundStyle(Palette.inkSoft)
            } else {
                Text("This link can't be opened").font(Typeface.display(26)).foregroundStyle(Palette.ink)
                Text(StreamError.notAnInvitation.errorDescription ?? "").font(.system(size: 16))
                    .foregroundStyle(Palette.inkSoft)
            }
            if let error = model.error {
                NoticeBanner(text: error) { model.error = nil }
            }
            Spacer()
            if let invitation {
                Button {
                    Haptics.tap()
                    Task {
                        if let landing = await model.join(invitation) {
                            Haptics.success()
                            onJoined(landing)
                        } else {
                            Haptics.failure()
                        }
                    }
                } label: {
                    if model.isWorking { ProgressView().tint(Palette.ink) } else { Text("Join") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isWorking)
            }
            Button("Not now") { dismiss() }.buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium])
        .background(Palette.surface)
    }

    private func summary(_ invitation: StreamInvitation) -> String {
        let stream = invitation.namespaceName.map { "“\($0)”" } ?? "a stream"
        if invitation.opensRoom {
            let room = invitation.roomName.map { "“\($0)”" } ?? "a room"
            return "You're invited to \(room) in \(stream). Joining adds you to the stream and opens the call."
        }
        return "You're invited to \(stream). Joining gives you every room in it, including rooms made later."
    }
}
