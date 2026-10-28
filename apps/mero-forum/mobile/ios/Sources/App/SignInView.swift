import ForumCore
import MeroKitUI
import SwiftUI

/// The front door: what Mero Forum is, and one way in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 84, height: 84)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                VStack(spacing: 10) {
                    Text("Mero Forum").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Discussions that live on your members' own nodes. No server in between.")
                        .font(.system(size: 17))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                }
                if let invitedTo {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.open")
                        Text("You're invited to join “\(invitedTo)”. Sign in to accept.")
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

/// Join a space or forum from a link: ask, join, then say where it landed.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (InvitationDestination) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title, let isForum):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Join “\(title)”?")
                Text(
                    isForum
                        ? "Joining takes you straight into that forum."
                        : "Joining gives you access to the space and every forum in it."
                )
                .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining(let title):
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining “\(title)”…").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("This can take up to a minute when no other member is online.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let destination):
                header(symbol: "checkmark", tone: Palette.lime, title: "You're in “\(destination.forum?.forumName ?? destination.spaceName)”")
                Text(destination.forum == nil ? "Its forums are on the next screen." : "The forum opens next.")
                    .font(.system(size: 16)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                Button("Open") {
                    open(destination)
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
