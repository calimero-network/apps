import LocalAuthentication
import MeroKitUI
import PassCore
import SwiftUI

/// The front door: what Mero Pass is, and one way in.
struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    var invitedTo: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 20) {
                Image(systemName: "key.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 84, height: 84)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.lime))
                VStack(spacing: 10) {
                    Text("Mero Pass").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text("Passwords shared with your team, encrypted on your phone before they leave it.")
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
            CloudSignInPanel(style: .app)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
    }
}

/// Signed in, key not in memory: Face ID, Touch ID or the passcode opens it.
/// The first unlock on a phone makes its device key.
struct LockScreen: View {
    @EnvironmentObject private var keeper: DeviceKeeper
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 76, height: 76)
                    .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Palette.lime))
                Text(keeper.hasKey ? "Mero Pass is locked" : "Protect this phone's key")
                    .font(Typeface.display(26)).foregroundStyle(Palette.ink)
                Text(
                    keeper.hasKey
                        ? "Unlock to open your vaults. Every vault key is wrapped to this phone's key, kept in the Keychain on this device only."
                        : "This phone gets its own key, kept in the Keychain on this device only and opened with \(Self.biometryName). Vault keys are wrapped to it."
                )
                .font(.system(size: 16))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                if let error {
                    Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error)
                }
            }
            .padding(.horizontal, 28)
            Spacer()
            Button {
                unlock()
            } label: {
                if busy {
                    ProgressView().tint(Palette.ink)
                } else {
                    Label(keeper.hasKey ? "Unlock" : "Set up and unlock", systemImage: Self.biometrySymbol)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.ground.ignoresSafeArea())
        .task { unlock() }
    }

    private static var biometry: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType
    }

    static var biometryName: String {
        switch biometry {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "your passcode"
        }
    }

    static var biometrySymbol: String {
        switch biometry {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.open"
        }
    }

    private func unlock() {
        guard !busy else { return }
        busy = true
        error = nil
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            // No passcode on this phone: nothing to ask. The key is still
            // this-device-only in the Keychain; Security says to set one.
            open()
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your vaults") { ok, failure in
            Task { @MainActor in
                if ok {
                    open()
                } else {
                    busy = false
                    if let failure = failure as? LAError, failure.code == .userCancel || failure.code == .appCancel
                        || failure.code == .systemCancel
                    {
                        return
                    }
                    error = "Couldn't confirm it's you. Try again."
                }
            }
        }
    }

    private func open() {
        do {
            try keeper.unlock()
            Haptics.success()
        } catch {
            self.error = PassErrorText.describe(error)
        }
        busy = false
    }
}

/// Join a team or vault from a link: ask, join, then say where it landed.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (InvitationDestination) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm(let title, let isVault, let teamName):
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Join “\(title)”?")
                Text(
                    isVault
                        ? "This opens “\(title)”, and the access it grants is the whole of \(teamName): every open vault in the team."
                        : "Joining gives you access to the team and every open vault in it."
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
                header(
                    symbol: "checkmark", tone: Palette.lime,
                    title: "You're in “\(destination.vault?.vaultName ?? destination.teamName)”")
                Text(
                    destination.vault == nil
                        ? "Its vaults are on the next screen. Each one opens once a member who holds its key lets this phone in."
                        : "The vault opens next. Its items appear once a member who holds the key lets this phone in."
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
            await model.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}

/// An invitation link to share or copy, with what it grants.
struct InviteLinkSheet: View {
    let title: String
    let link: String
    let hint: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(title: title, action: nil, cancel: { dismiss() })
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(hint).font(.system(size: 15)).foregroundStyle(Palette.muted)
                    Text(link)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(4)
                        .truncationMode(.middle)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                    ShareLink(item: link) {
                        Label("Share link", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = link
                        copied = true
                        Haptics.tap()
                    } label: {
                        Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Text("An invitation never carries a secret: their phone or browser gets each vault's key from a member who holds it.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                .padding(20)
            }
        }
        .background(Palette.surface)
    }
}

/// Paste an invitation link someone sent.
struct JoinSheet: View {
    let open: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Join with a link", action: "Continue", canAct: !text.trimmingCharacters(in: .whitespaces).isEmpty,
                cancel: { dismiss() },
                act: {
                    dismiss()
                    open(text)
                })
            VStack(alignment: .leading, spacing: 14) {
                InputField(label: "Invitation link or code", text: $text, placeholder: "https://links.calimero.network/…", multiline: true)
                Button {
                    if let pasted = UIPasteboard.general.string { text = pasted }
                } label: {
                    Label("Paste", systemImage: "doc.on.clipboard")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                Text("Ask someone in the team to invite you from their Mero Pass.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                Spacer()
            }
            .padding(20)
        }
        .background(Palette.surface)
    }
}
