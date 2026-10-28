import BattleshipsCore
import MeroKitUI
import SwiftUI

/// The front door: what Battleships is, and one way in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                Image(systemName: "scope")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 84, height: 84)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                VStack(spacing: 10) {
                    Text("Battleships").font(Typeface.display(34, weight: .bold)).foregroundStyle(Palette.ink)
                    Text("Two players, two hidden fleets. Your board never leaves this phone until the last shot.")
                        .font(.system(size: 17))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                }
                if let invitedTo {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.open")
                        Text("You're invited to “\(invitedTo)”. Sign in to accept.")
                            .font(.system(size: 15, weight: .medium))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.limeSoft))
                }
            }
            .padding(.horizontal, 28)
            Spacer()
            VStack(spacing: 12) {
                if let error = session.client.errorMessage {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger).multilineTextAlignment(.center)
                }
                Button {
                    Haptics.tap()
                    busy = true
                    Task {
                        await session.signIn()
                        busy = false
                    }
                } label: {
                    if busy {
                        ProgressView().tint(Palette.ink)
                    } else {
                        Label("Sign in with Calimero", systemImage: "person.crop.circle.badge.checkmark")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
                Text("You'll approve this device in your Calimero wallet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.muted)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
    }
}

/// Join a lobby from a link: ask, join, then open it.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (_ namespaceId: String, _ title: String) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Join “\(title)”?")
                Text("You'll see its matches and can challenge anyone in it.")
                    .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining(let title):
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining “\(title)”…").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("This can take up to a minute when no other player is online.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let namespaceId, let title):
                header(symbol: "checkmark", tone: Palette.lime, title: "You're in “\(title)”")
                Text("The lobby opens next.").font(.system(size: 16)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                Button("Open lobby") {
                    open(namespaceId, title)
                    model.reset()
                }
                .buttonStyle(PrimaryButtonStyle())
            case .failed(let message):
                header(symbol: "exclamationmark.triangle", tone: Palette.dangerSoft, title: "Couldn't join")
                Text(message).font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                if model.invitation != nil {
                    Button("Try again") { accept() }.buttonStyle(PrimaryButtonStyle())
                }
                Button("Close") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.surface)
    }

    private func header(symbol: String, tone: Color, title: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 60, height: 60)
                .background(Circle().fill(tone))
            Text(title).font(Typeface.display(22)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
        }
        .padding(.top, 8)
    }

    private func accept() {
        Haptics.tap()
        Task {
            await model.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}
