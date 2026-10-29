import MeroKitUI
import SignCore
import SwiftUI

/// The front door: what Mero Sign is, and one way in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                Image(systemName: "signature")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 84, height: 84)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                VStack(spacing: 10) {
                    Text("Mero Sign").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Review and sign agreements peer to peer. Documents live on the nodes of the people who sign them.")
                        .font(.system(size: 17))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                }
                if let invitedTo {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.open")
                        Text("You're invited to sign “\(invitedTo)”. Sign in to accept.")
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

/// Join from a link: ask, join, open the agreement, then say where it landed.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (InvitationDestination) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Open “\(title)”?")
                Text("You'll join its workspace and be registered as a signer of this agreement.")
                    .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join and open") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining(let title, let step):
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining “\(title)”").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.center)
                Text(step).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.inkSoft)
                Text("This can take up to a minute when no other signer is online.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let destination):
                header(
                    symbol: "checkmark", tone: Palette.lime,
                    title: "You're in “\(destination.agreement?.name ?? destination.workspaceName)”")
                Text(
                    destination.agreement == nil
                        ? "Its agreements appear in your inbox as they sync."
                        : "Its documents are ready to review."
                )
                .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
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
            await model.accept(
                directory: {
                    guard let backend = session.backend else { return nil }
                    let signAdmin = BackendSignAdmin(backend: backend, admin: session.client.admin)
                    return AgreementDirectory(
                        backend: backend,
                        store: PrivateStore(
                            backend: backend, admin: signAdmin, applicationId: session.applicationId,
                            cache: DefaultsPrivateContextCache()))
                },
                didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}

/// Paste an invitation link someone sent you.
struct PasteInvitationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let open: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Open an invitation", action: "Open",
                canAct: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, busy: false,
                cancel: { dismiss() },
                act: {
                    let raw = text
                    dismiss()
                    open(raw)
                })
            VStack(alignment: .leading, spacing: 12) {
                Text("Paste the link you were sent to sign an agreement.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                TextField("https://links.calimero.network/…", text: $text, axis: .vertical)
                    .font(.system(size: 15, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                if UIPasteboard.general.hasStrings {
                    Button {
                        text = UIPasteboard.general.string ?? ""
                    } label: {
                        Label("Paste from clipboard", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .onAppear { focused = true }
    }
}
